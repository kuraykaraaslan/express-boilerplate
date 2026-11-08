import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { lookup as dnsLookup } from 'node:dns'
import { timingSafeEqual } from 'node:crypto'
import { createValidatingLookup, SsrfError } from '@kuraykaraaslan-labs/common/server/safe-fetch'

/**
 * The browser's only way out (observability phase 09, D-OBS-8): a forward proxy that lives INSIDE the runner, on 127.0.0.1, for the life of ONE check.
 *
 * Chromium is launched with `--proxy-server` pointing here and `--host-resolver-rules` that stop it resolving anything itself, so every request it makes (page, sub-resources,
 * redirects, `fetch`, `XMLHttpRequest`, `WebSocket` upgrades, `EventSource`) arrives here as either an absolute-URI HTTP request or a CONNECT tunnel. Each one is judged by the
 * SAME connection guard every other probe uses (`createValidatingLookup`: resolve ALL addresses, refuse if ANY is private or reserved, or not allowed by the location's CIDRs in
 * `public_or_listed` mode) and the connection is made to the address that was validated: there is no second lookup, so DNS rebinding has no window. A name that resolves
 * public now and private on the next connection is refused on that next connection, because every new connection resolves and judges again.
 *
 *  - A redirect to a disallowed host needs no special case: the browser follows it by making a new request, which arrives here and is refused like any other.
 *  - A raw `Upgrade` request (a `ws://` handshake sent as a plain proxied GET) is refused outright; Chromium tunnels WebSockets through CONNECT, which is judged like HTTPS.
 *  - The proxy demands credentials (a random per-check secret handed to the browser at launch), so nothing else on the host can borrow it.
 *  - Bounded: connections, requests and bytes per check, with an idle timeout on every socket. A page that tries to pull the internet through the runner is cut off.
 * Pure Node (no platform code): the runner bundle imports only this and the guard.
 */

export interface BlockedRequest { host: string; port: number; reason: string; kind: 'http' | 'connect' | 'upgrade' | 'auth' | 'limit' }

export interface EgressProxyOptions {
  /** The CIDRs the location's runner may reach in addition to public addresses (`public_or_listed`); empty = public addresses only. */
  allowlist?: string[]
  /** The credential the browser must present (Proxy-Authorization: Basic base64(`probe:<token>`)). */
  token: string
  /** Replaceable for tests (DNS rebinding); production uses the system resolver. */
  resolve?: typeof dnsLookup
  maxConnections?: number
  maxRequests?: number
  /** Total bytes relayed in both directions before everything is cut. */
  maxBytes?: number
  idleTimeoutMs?: number
  /** Called once when the byte or request budget cuts the check off, so the owner of the browser can end the run at once instead of waiting for its timeouts. */
  onExhausted?: (what: 'bytes' | 'requests') => void
}

export const PROXY_USER = 'probe'
const HOP_BY_HOP = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

export class EgressProxy {
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private readonly guard: ReturnType<typeof createValidatingLookup>
  private readonly tokenBuf: Buffer
  readonly blocked: BlockedRequest[] = []
  requests = 0
  bytes = 0
  /** Set when the byte or request budget cut the check off. */
  exhausted: 'bytes' | 'requests' | null = null
  private readonly max: Required<Pick<EgressProxyOptions, 'maxConnections' | 'maxRequests' | 'maxBytes' | 'idleTimeoutMs'>>

  constructor(private readonly opts: EgressProxyOptions) {
    this.guard = createValidatingLookup(opts.allowlist && opts.allowlist.length ? opts.allowlist : null, opts.resolve ?? dnsLookup, 'public_or_listed')
    this.tokenBuf = Buffer.from(`${PROXY_USER}:${opts.token}`)
    this.max = { maxConnections: opts.maxConnections ?? 64, maxRequests: opts.maxRequests ?? 1500, maxBytes: opts.maxBytes ?? 40 * 1024 * 1024, idleTimeoutMs: opts.idleTimeoutMs ?? 20_000 }
  }

  /** Listens on 127.0.0.1 only, on a port the OS picks. */
  async start(): Promise<{ port: number }> {
    const server = createServer((req, res) => { void this.onRequest(req, res) })
    server.on('connect', (req, socket, head) => { void this.onConnect(req, socket as Socket, head) })
    server.on('upgrade', (req, socket) => this.refuseUpgrade(req, socket as Socket))
    server.on('clientError', (_e, socket) => { try { socket.destroy() } catch { /* gone */ } })
    server.maxConnections = this.max.maxConnections + 8
    this.server = server
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('proxy did not bind')
    return { port: addr.port }
  }

  /** Close the listener and every open tunnel. Idempotent. */
  async stop(): Promise<void> {
    for (const s of this.sockets) { try { s.destroy() } catch { /* gone */ } }
    this.sockets.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.() })
  }

  // ---- policy ------------------------------------------------------------------------------------------------------------

  private block(entry: BlockedRequest): void {
    if (this.blocked.length < 25) this.blocked.push({ ...entry, reason: entry.reason.slice(0, 200) })
  }

  private authorised(header: string | string[] | undefined): boolean {
    const h = Array.isArray(header) ? header[0] : header
    const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(h ?? '')
    if (!m) return false
    const given = Buffer.from(m[1], 'base64')
    return given.length === this.tokenBuf.length && timingSafeEqual(given, this.tokenBuf)
  }

  /** Count and bound one request. Returns false (and says why) when a budget is spent. */
  private admit(): { ok: true } | { ok: false; reason: string } {
    if (this.exhausted) return { ok: false, reason: `the ${this.exhausted} budget of this check is spent` }
    this.requests += 1
    if (this.requests > this.max.maxRequests) { this.exhausted = 'requests'; void this.cut(); this.opts.onExhausted?.('requests'); return { ok: false, reason: 'too many requests for one check' } }
    if (this.sockets.size >= this.max.maxConnections) return { ok: false, reason: 'too many open connections' }
    return { ok: true }
  }

  /** Cut every open connection, a moment later so the refusal that triggered it still reaches the browser. */
  private async cut(): Promise<void> {
    await new Promise((r) => setTimeout(r, 40))
    for (const s of this.sockets) { try { s.destroy() } catch { /* gone */ } }
  }

  /** Resolve and judge in ONE step, with the connection guard; returns the validated address to connect to. */
  private pin(host: string): Promise<{ address: string; family: number }> {
    return new Promise((resolve, reject) => {
      this.guard(host, { all: false }, (err, address, family) => {
        if (err) return reject(err)
        resolve({ address: String(address), family: Number(family) || 4 })
      })
    })
  }

  private track(s: Socket): void {
    this.sockets.add(s)
    s.setTimeout(this.max.idleTimeoutMs, () => s.destroy())
    s.once('close', () => this.sockets.delete(s))
    s.on('error', () => { /* a reset by the peer is normal */ })
  }

  private count(n: number): void {
    this.bytes += n
    if (this.bytes > this.max.maxBytes && !this.exhausted) { this.exhausted = 'bytes'; void this.cut(); this.opts.onExhausted?.('bytes') }
  }

  // ---- plain HTTP (absolute-URI) -----------------------------------------------------------------------------------------

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fail = (status: number, reason: string, host = '', port = 0, kind: BlockedRequest['kind'] = 'http') => {
      this.block({ host, port, reason, kind })
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain', 'x-probe-blocked': 'egress', connection: 'close' })
      res.end(`blocked by the probe runner: ${reason.slice(0, 100)}`)
    }
    this.track(req.socket)
    if (!this.authorised(req.headers['proxy-authorization'])) { res.setHeader('proxy-authenticate', 'Basic realm="probe"'); return fail(407, 'proxy authentication required', '', 0, 'auth') }
    if ((req.headers.upgrade ?? '') !== '') return this.refuseUpgradeResponse(req, res)
    let url: URL
    try { url = new URL(req.url ?? '') } catch { return fail(400, 'not an absolute proxy request') }
    if (url.protocol !== 'http:') return fail(400, `only http requests are proxied this way (got ${url.protocol})`, url.hostname)
    const port = Number(url.port || 80)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const admit = this.admit()
    if (!admit.ok) return fail(429, admit.reason, host, port, 'limit')
    let pinned: { address: string; family: number }
    try { pinned = await this.pin(host) } catch (err) { return fail(403, err instanceof SsrfError || err instanceof Error ? err.message : 'blocked', host, port) }

    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v
    headers.host = url.host
    headers.connection = 'close'
    const upstream = httpRequest({
      host: pinned.address, family: pinned.family, port, method: req.method, path: `${url.pathname}${url.search}`, headers, agent: false, setHost: false,
    }, (up) => {
      const out: Record<string, string | string[]> = {}
      for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) out[k] = v
      out.connection = 'close'
      res.writeHead(up.statusCode ?? 502, out)
      up.on('data', (c: Buffer) => this.count(c.length))
      up.pipe(res)
    })
    if (upstream.socket) this.track(upstream.socket)
    upstream.on('socket', (s) => this.track(s))
    upstream.setTimeout(this.max.idleTimeoutMs, () => upstream.destroy(new Error('upstream timed out')))
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { connection: 'close' }); res.end() })
    // An upstream that goes away mid-body must not leave the browser waiting for the rest.
    upstream.on('close', () => { if (!res.writableEnded) res.destroy() })
    req.on('data', (c: Buffer) => this.count(c.length))
    req.pipe(upstream)
    res.on('close', () => upstream.destroy())
  }

  private refuseUpgradeResponse(req: IncomingMessage, res: ServerResponse): void {
    this.block({ host: (req.headers.host ?? '').slice(0, 100), port: 0, reason: 'a raw Upgrade request is not proxied', kind: 'upgrade' })
    res.writeHead(400, { 'x-probe-blocked': 'egress', connection: 'close' }); res.end()
  }

  private refuseUpgrade(req: IncomingMessage, socket: Socket): void {
    this.block({ host: (req.headers.host ?? '').slice(0, 100), port: 0, reason: 'a raw Upgrade request is not proxied', kind: 'upgrade' })
    try { socket.end('HTTP/1.1 400 Bad Request\r\nx-probe-blocked: egress\r\nconnection: close\r\n\r\n') } catch { /* gone */ }
  }

  // ---- CONNECT (HTTPS and WebSocket) -------------------------------------------------------------------------------------

  private async onConnect(req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    this.track(client)
    const refuse = (status: number, text: string, reason: string, host = '', port = 0, kind: BlockedRequest['kind'] = 'connect') => {
      this.block({ host, port, reason, kind })
      try { client.end(`HTTP/1.1 ${status} ${text}\r\nx-probe-blocked: egress\r\nconnection: close\r\n\r\n`) } catch { /* gone */ }
    }
    if (!this.authorised(req.headers['proxy-authorization'])) return refuse(407, 'Proxy Authentication Required', 'proxy authentication required', '', 0, 'auth')
    const m = /^(\[[0-9a-fA-F:.]+\]|[^:\s/]+):(\d{1,5})$/.exec(req.url ?? '')
    const port = m ? Number(m[2]) : 0
    if (!m || port < 1 || port > 65535) return refuse(400, 'Bad Request', 'not a host:port CONNECT target')
    const host = m[1].replace(/^\[|\]$/g, '')
    const admit = this.admit()
    if (!admit.ok) return refuse(429, 'Too Many Requests', admit.reason, host, port, 'limit')
    let pinned: { address: string; family: number }
    try { pinned = await this.pin(host) } catch (err) { return refuse(403, 'Forbidden', err instanceof Error ? err.message : 'blocked', host, port) }

    const upstream = netConnect({ host: pinned.address, port, family: pinned.family })
    this.track(upstream)
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) { this.count(head.length); upstream.write(head) }
      client.on('data', (c: Buffer) => this.count(c.length))
      upstream.on('data', (c: Buffer) => this.count(c.length))
      client.pipe(upstream); upstream.pipe(client)
    })
    upstream.once('error', () => { if (!client.destroyed) refuse(502, 'Bad Gateway', 'the upstream connection failed', host, port) })
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
  }
}
