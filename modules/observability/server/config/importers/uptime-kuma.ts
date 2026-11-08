import { ConfigParseError, scanHostile } from '../config.parse'
import { blank, finish, isObj, KeyAllocator, newReport, num, parseJson, secretHeader, str, type Importer } from './importer.types'

/**
 * Uptime Kuma: the 1.x JSON backup, and what 2.x offers instead.
 *
 * 1.x (VERIFIED 2026-10-18 on tag 1.23.16: server/server.js `uploadBackup`, src/components/settings/Backup.vue `downloadBackup`, server/model/monitor.js
 * `toJSON`): a backup is `{ version, notificationList, proxyList, monitorList }`, `monitorList` an ARRAY of monitor `toJSON` objects.
 *
 * 2.x (VERIFIED 2026-10-18 on tag 2.5.6 and the migration wiki): the JSON backup and restore were DROPPED (PR #3892, "Drop backup and restore feature", release
 * 2.0.0-beta.0; the wiki "Migration From v1 To v2" says backing up the `data` directory is the only supported backup). There is no export file, so
 * this importer reads the two things 2.x does hand out, both made of the same monitor objects:
 *  - the `monitorList` Socket.IO event (server/uptime-kuma-server.js `getMonitorJSONList`: an OBJECT keyed by monitor id, each value `monitor.toJSON()`),
 *    which a logged-in client receives on login or by emitting `getMonitorList`; saved as JSON it is read as is (an object of monitors, a list of
 *    monitors, or `{ monitorList: ... }` in either form). `toJSON` in 2.5.6 keeps every field read here (name, type, url, method, hostname, port, interval,
 *    retryInterval, maxretries, timeout, keyword, invertKeyword, accepted_statuscodes, ignoreTls, upsideDown, dns_resolve_*, parent, active, tags,
 *    notificationIDList, headers, body, basic_auth_user, proxyId, pushToken) and adds `authMethod` (null, basic, bearer, oauth2-cc, mtls, ntlm).
 *  - rows of the `monitor` table (db/knex_init_db.js and its migrations; columns `ignore_tls`, `upside_down`, `invert_keyword`, `retry_interval`,
 *    `accepted_statuscodes_json`, `push_token`, `proxy_id`, `parent`, `timeout`), for example `sqlite3 -json data/kuma.db "SELECT * FROM monitor"`: the snake_case
 *    columns are mapped to the `toJSON` names. Tags and notification links live in other tables and are not part of such rows.
 * NOT VERIFIED: no real 2.x export was produced here (no running 2.x instance); the 2.x reading rests on the source above. The list of 2.x monitor types
 * (pm2, websocket-upgrade, sftp, manual, globalping, ntp, smtp, snmp, oracledb, system-service, ...) is from src/pages/EditMonitor.vue: none of them is mapped.
 */

const STATUS_LIMIT = 20

/** "200-299" and "301" to a list of codes; null when the whole thing is "any 2xx" (our default) or too large to list. */
function statusCodes(raw: unknown): { codes: number[] | null; note?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { codes: null }
  const set = new Set<number>()
  for (const part of raw) {
    const m = /^(\d{3})(?:-(\d{3}))?$/.exec(String(part).trim())
    if (!m) return { codes: null, note: `accepted status "${String(part)}" is not understood; any 2xx is used` }
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a
    for (let c = a; c <= b && set.size <= STATUS_LIMIT * 10; c += 1) set.add(c)
  }
  const all2xx = [...set].length === 100 && [...set].every((c) => c >= 200 && c <= 299)
  if (all2xx) return { codes: null }
  if (set.size > STATUS_LIMIT) return { codes: null, note: `accepted statuses cover ${set.size} codes (more than ${STATUS_LIMIT}); any 2xx is used` }
  return { codes: [...set].sort((x, y) => x - y) }
}

const UNMAPPED_TYPES = new Set(['docker', 'steam', 'gamedig', 'mqtt', 'sqlserver', 'grpc-keyword', 'postgres', 'mysql', 'mongodb', 'radius', 'redis', 'kafka-producer', 'json-query', 'real-browser', 'tailscale-ping', 'rabbitmq', 'oracledb', 'pm2', 'websocket-upgrade', 'sftp', 'manual', 'globalping', 'ntp', 'smtp', 'snmp', 'system-service'])

/** Columns of the `monitor` table to the names of `Monitor.toJSON()`; a name already present wins. */
const COLUMN_TO_JSON: Record<string, string> = { ignore_tls: 'ignoreTls', upside_down: 'upsideDown', invert_keyword: 'invertKeyword', retry_interval: 'retryInterval' }

function normalizeMonitor(row: Record<string, unknown>): Record<string, unknown> {
  const m: Record<string, unknown> = { ...row }
  for (const [col, name] of Object.entries(COLUMN_TO_JSON)) if (col in m && !(name in m)) m[name] = m[col]
  if (typeof m.accepted_statuscodes_json === 'string' && !('accepted_statuscodes' in m)) {
    try { m.accepted_statuscodes = JSON.parse(m.accepted_statuscodes_json) } catch { /* left out: the any-2xx default applies */ }
  }
  return m
}

/**
 * The monitors of whichever shape was given: a 1.x backup (`monitorList` array), a 2.x `monitorList` event payload (an object keyed by id), a list of
 * monitors, or table rows. Null when it is none of these.
 */
function monitorsOf(v: unknown): { rows: unknown[]; shape: string } | null {
  const objectOfMonitors = (o: Record<string, unknown>): unknown[] | null => {
    const values = Object.values(o)
    return values.length > 0 && values.every((x) => isObj(x) && typeof x.type === 'string') ? values : null
  }
  if (Array.isArray(v)) return { rows: v, shape: 'a list of monitors' }
  if (!isObj(v)) return null
  if (Array.isArray(v.monitorList)) return { rows: v.monitorList, shape: 'a 1.x backup (monitorList list)' }
  if (isObj(v.monitorList)) { const r = objectOfMonitors(v.monitorList); return r ? { rows: r, shape: 'a 2.x monitorList (object keyed by id)' } : null }
  const r = objectOfMonitors(v)
  return r ? { rows: r, shape: 'a 2.x monitorList event payload (object keyed by id)' } : null
}

export const uptimeKumaImporter: Importer = {
  id: 'uptime-kuma',
  title: 'Uptime Kuma 1.x backup, or a 2.x monitor list (JSON)',
  accepts: ['json'],
  cannotMap: [
    'notification channels (the routes and targets of the alert pipeline are different objects; the channel names are listed)',
    'proxies, upside-down mode, TLS-ignore, non-GET methods and request bodies (they change what "up" means)',
    'database, queue, game, container, MQTT, gRPC, RADIUS and browser checks (no equivalent check type)',
    'push tokens, header values and basic-auth credentials (never copied: environment references are written instead)',
    'status pages and incidents (not part of the backup)',
    'OAuth2, NTLM and mTLS authentication of a monitor (2.x): no equivalent; a bearer token is never copied (an environment reference is written)',
    'Uptime Kuma 2.x has no export file (the JSON backup was dropped): only the monitorList event payload or monitor table rows can be read, see the phase document',
  ],
  run(text) {
    const report = newReport('uptime-kuma', '1.x backup verified against the 1.23.16 source; 2.x monitorList / table rows read from the 2.5.6 source (no real 2.x export was available)')
    const parsed = parseJson(text)
    if ('error' in parsed) { report.errors.push(parsed.error); return finish(report, blank()) }
    try { scanHostile(parsed.value) } catch (e) { report.errors.push((e as ConfigParseError).message); return finish(report, blank()) }
    const found = monitorsOf(parsed.value)
    if (!found) { report.errors.push('this is not an Uptime Kuma backup or monitor list (expected a 1.x backup with monitorList, a 2.x monitorList object, or a list of monitors)'); return finish(report, blank()) }
    const root = isObj(parsed.value) ? parsed.value : {}
    const monitorList = found.rows
    report.warnings.push(`read as ${found.shape}`)
    if (monitorList.length > 500) { report.errors.push('more than 500 monitors: split the backup'); return finish(report, blank()) }
    if (Array.isArray(root.notificationList) && root.notificationList.length > 0) {
      const names = root.notificationList.map((n) => (isObj(n) ? str(n.name) : null)).filter((n): n is string => n !== null)
      report.unmapped.push({ item: `${names.length} notification channel(s): ${names.slice(0, 20).join(', ')}`, reason: 'channels are not imported: create alert routes and targets for them (webhook, notify, on_call)' })
    }
    if (Array.isArray(root.proxyList) && root.proxyList.length > 0) report.unmapped.push({ item: `${root.proxyList.length} prox(ies)`, reason: 'probes go through the platform SSRF guard; proxies are not supported' })

    const rows = monitorList.filter(isObj).map(normalizeMonitor)
    if (rows.length !== monitorList.length) { report.errors.push('the monitor list contains an entry that is not an object'); return finish(report, blank()) }
    const groupName = new Map<number, string>()
    for (const m of rows) if (m.type === 'group' && num(m.id) !== null && str(m.name)) groupName.set(num(m.id) as number, str(m.name) as string)

    const keys = new KeyAllocator()
    const draft = blank()
    for (const m of rows) {
      const name = str(m.name)
      const from = `monitor "${name ?? '(unnamed)'}" (${String(m.type)})`
      if (!name) { report.unmapped.push({ item: from, reason: 'no name' }); continue }
      const type = String(m.type)
      if (type === 'group') { report.mapped.push({ kind: 'group', key: '-', from, notes: ['becomes the groupName of its children'] }); continue }
      if (UNMAPPED_TYPES.has(type) || !['http', 'keyword', 'port', 'ping', 'dns', 'push'].includes(type)) { report.unmapped.push({ item: from, reason: `the check type "${type}" has no equivalent` }); continue }
      if (m.upsideDown === true || m.upsideDown === 1) { report.unmapped.push({ item: from, reason: 'upside-down mode inverts what up means; there is no equivalent' }); continue }
      if (type === 'keyword' && (m.invertKeyword === true || m.invertKeyword === 1)) { report.unmapped.push({ item: from, reason: 'an inverted keyword check has no equivalent' }); continue }
      const authMethod = str(m.authMethod)
      if ((type === 'http' || type === 'keyword') && authMethod && ['oauth2-cc', 'ntlm', 'mtls'].includes(authMethod)) { report.unmapped.push({ item: from, reason: `authentication method ${authMethod} has no equivalent (only static headers are sent)` }); continue }
      const method = str(m.method)
      if ((type === 'http' || type === 'keyword') && method && method.toUpperCase() !== 'GET') { report.unmapped.push({ item: from, reason: `method ${method}: HTTP checks send GET` }); continue }
      if ((type === 'http' || type === 'keyword') && str(m.body)) { report.unmapped.push({ item: from, reason: 'a request body cannot be sent by an HTTP check (use a STEPS monitor)' }); continue }
      if (m.ignoreTls === true || m.ignoreTls === 1) { report.unmapped.push({ item: from, reason: 'ignoring TLS errors is not offered: probes always verify certificates' }); continue }

      const key = keys.next(name, 'monitor')
      const notes: string[] = []
      const interval = num(m.interval) ?? 60
      const out: Record<string, unknown> = { key, name, intervalSeconds: Math.min(86400, Math.max(1, Math.round(interval))) }
      const timeout = num(m.timeout)
      if (timeout !== null && timeout > 0) out.timeoutMs = Math.min(120000, Math.round(timeout * 1000))
      const retries = num(m.maxretries)
      if (retries !== null && retries >= 0) out.consecutiveFailThreshold = Math.min(20, Math.max(1, Math.round(retries) + 1))
      if (m.active === 0 || m.active === false) out.isActive = false
      const parent = num(m.parent)
      if (parent !== null && groupName.has(parent)) out.groupName = (groupName.get(parent) as string).slice(0, 100)
      if (Array.isArray(m.tags)) {
        const tags = m.tags.map((t) => (isObj(t) ? [str(t.name), str(t.value)] : [str(t), null])).flatMap(([n, v]) => (n ? [v ? `${n}:${v}` : n].map((s) => (s as string).slice(0, 40)) : []))
        if (tags.length) out.tags = tags.slice(0, 20)
      }
      switch (type) {
        case 'http': case 'keyword': {
          const url = str(m.url)
          if (!url) { report.unmapped.push({ item: from, reason: 'no url' }); continue }
          Object.assign(out, { type: 'HTTP', target: url })
          const sc = statusCodes(m.accepted_statuscodes)
          if (sc.note) notes.push(sc.note)
          if (sc.codes) out.assertions = [{ kind: 'status', in: sc.codes }]
          if (type === 'keyword') { const kw = str(m.keyword); if (kw) out.expectedBodyContains = kw.slice(0, 500); else notes.push('keyword check without a keyword: only the status is checked') }
          break
        }
        case 'port': {
          const host = str(m.hostname); const port = num(m.port)
          if (!host || port === null) { report.unmapped.push({ item: from, reason: 'no hostname or port' }); continue }
          Object.assign(out, { type: 'TCP', target: `${host}:${port}` }); break
        }
        case 'ping': {
          const host = str(m.hostname)
          if (!host) { report.unmapped.push({ item: from, reason: 'no hostname' }); continue }
          Object.assign(out, { type: 'PING', target: host }); notes.push('a PING monitor is a TCP reachability check (443, then 80), not ICMP'); break
        }
        case 'dns': {
          const host = str(m.hostname)
          if (!host) { report.unmapped.push({ item: from, reason: 'no hostname' }); continue }
          Object.assign(out, { type: 'DNS', target: `${str(m.dns_resolve_type) ?? 'A'}@${host}` })
          if (str(m.keyword)) out.expectedBodyContains = (str(m.keyword) as string).slice(0, 500)
          if (str(m.dns_resolve_server) && m.dns_resolve_server !== '1.1.1.1') notes.push('the custom resolver is not used: DNS checks use the platform resolver')
          break
        }
        case 'push':
          Object.assign(out, { type: 'HEARTBEAT', target: undefined })
          notes.push('a new heartbeat URL is issued when the file is applied; the job must be pointed at it (the old push token is never copied)')
          break
      }
      if (str(m.headers) && str(m.headers) !== '{}') {
        try {
          const h = JSON.parse(str(m.headers) as string) as Record<string, unknown>
          if (isObj(h) && Object.keys(h).length) {
            out.headers = Object.fromEntries(Object.keys(h).slice(0, 20).map((n) => [n, secretHeader(report, key, n)]))
            notes.push('header values are not copied: provide the environment variables listed in the report')
          }
        } catch { notes.push('the headers field is not valid JSON and was dropped') }
      }
      if (authMethod === 'bearer') {
        out.headers = { ...(out.headers as object | undefined), Authorization: secretHeader(report, key, 'Authorization') }
        notes.push('the bearer token is not copied: set the Authorization environment variable to "Bearer <token>"')
      } else if ((authMethod === null || authMethod === 'basic') && (str(m.basic_auth_user) || str(m.basicAuthUser))) {
        out.headers = { ...(out.headers as object | undefined), Authorization: secretHeader(report, key, 'Authorization') }
        notes.push('basic-auth credentials are not copied: set the Authorization environment variable to "Basic <base64 of user:password>"')
      }
      if (Array.isArray(m.notificationIDList) ? m.notificationIDList.length > 0 : isObj(m.notificationIDList) && Object.keys(m.notificationIDList).length > 0) notes.push('its notification channels are not imported')
      if (num(m.proxyId) !== null || num(m.proxy_id) !== null) notes.push('its proxy is not used')
      draft.monitors.push(out as never)
      report.mapped.push({ kind: 'monitor', key, from, notes })
    }
    return finish(report, draft)
  },
}
