import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import Logger from '@kuraykaraaslan-labs/logger'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { STORAGE_MESSAGES } from './storage.messages'
import { presignS3GetUrl } from './storage.sigv4'
import { getProvider, getStorageSettings } from './storage.provider-factory'
import { auditStorageLinkEvent, STORAGE_AUDIT_EVENTS } from './storage.audit'
import {
  claimSingleUse,
  isObjectDownloadable,
  resolveDownloadLink,
  type DownloadLinkRecord,
} from './storage.links'
import { storageFetch } from './storage.safe-fetch'

/**
 * Serves `GET /api/storage/links/[token]` (docs/phases/15-storage/01). The handler
 * file stays a thin adapter; everything testable lives here.
 *
 * Unknown / expired / revoked / wrong-tenant / wrong-audience / not-downloadable
 * all answer the SAME 404 — a prober learns nothing about which it was.
 */

const notFound = () => new AppError(STORAGE_MESSAGES.LINK_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

export interface ByteRange {
  start: number
  end: number // inclusive
}

/**
 * Parse a single-range `Range: bytes=…` header against a known size.
 * Returns `null` for "no / unsupported (multi-range) header → serve everything",
 * `'unsatisfiable'` for a range outside the object.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null // multi-range or malformed: ignore, serve the whole object (RFC 9110 allows it)
  const [, a, b] = m
  if (a === '' && b === '') return null
  let start: number
  let end: number
  if (a === '') {
    const suffix = parseInt(b, 10)
    if (suffix === 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = parseInt(a, 10)
    end = b === '' ? size - 1 : Math.min(parseInt(b, 10), size - 1)
  }
  if (!Number.isFinite(start) || start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

/** Wrap a byte stream so the number of bytes actually delivered is known when it ends. */
export function meterStream(
  body: ReadableStream<Uint8Array>,
  onDone: (bytes: number, completed: boolean) => void,
): ReadableStream<Uint8Array> {
  let bytes = 0
  let finished = false
  const done = (completed: boolean) => {
    if (finished) return
    finished = true
    onDone(bytes, completed)
  }
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: end, value } = await reader.read()
        if (end) {
          controller.close()
          done(true)
          return
        }
        bytes += value.byteLength
        controller.enqueue(value)
      } catch (e) {
        controller.error(e)
        done(false)
      }
    },
    cancel(reason) {
      done(false)
      return reader.cancel(reason)
    },
  })
}

function clientIp(request: NextRequest): string {
  return Limiter.getIpFromRequest(request)
}

/** Resolve + authorise a link for this request. Throws the uniform 404. */
async function authorizeLink(request: NextRequest, tenantId: string, token: string) {
  const found = await resolveDownloadLink(token)
  if (!found || found.record.tenantId !== tenantId) throw notFound()
  const { hash, record } = found

  const aud = request.nextUrl.searchParams.get('aud')
  if (record.audience && record.audience !== aud) throw notFound()

  if (!(await isObjectDownloadable(tenantId, record.key))) throw notFound()

  if (record.singleUse) {
    const fingerprint = record.audience ?? clientIp(request)
    if (!(await claimSingleUse(hash, record, fingerprint))) throw notFound()
  }
  return { hash, record }
}

function baseHeaders(record: DownloadLinkRecord): Headers {
  const h = new Headers()
  h.set('Accept-Ranges', 'bytes')
  h.set('Cache-Control', 'private, no-store')
  h.set('Content-Type', record.contentType || 'application/octet-stream')
  if (record.filename) {
    const safe = record.filename.replace(/[\r\n"\\]/g, '_')
    h.set('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(record.filename)}`)
  }
  return h
}

function auditFetched(
  request: NextRequest,
  tenantId: string,
  hash: string,
  record: DownloadLinkRecord,
  extra: { range: string | null; bytes: number | null; status: number; mode: string; completed?: boolean },
) {
  void auditStorageLinkEvent(
    tenantId,
    STORAGE_AUDIT_EVENTS.LINK_FETCHED,
    hash,
    {
      purpose: record.purpose,
      key: record.key,
      audience: record.audience ?? null,
      ...extra,
    },
    { ip: clientIp(request), userAgent: request.headers.get('user-agent') ?? undefined },
  )
}

async function serveLocal(request: NextRequest, tenantId: string, hash: string, record: DownloadLinkRecord, fileUrl: string): Promise<Response> {
  const path = fileURLToPath(fileUrl)
  let st
  try {
    st = await stat(path)
  } catch {
    throw notFound()
  }
  if (!st.isFile()) throw notFound()

  const size = st.size
  const etag = `W/"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  const headers = baseHeaders(record)
  headers.set('ETag', etag)
  headers.set('Last-Modified', st.mtime.toUTCString())

  const rangeHeader = request.headers.get('range')
  const range = parseRange(rangeHeader, size)
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`)
    auditFetched(request, tenantId, hash, record, { range: rangeHeader, bytes: 0, status: 416, mode: 'stream' })
    return new Response(null, { status: 416, headers })
  }

  if (!range && request.headers.get('if-none-match') === etag) {
    auditFetched(request, tenantId, hash, record, { range: null, bytes: 0, status: 304, mode: 'stream' })
    return new Response(null, { status: 304, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const length = size === 0 ? 0 : end - start + 1
  headers.set('Content-Length', String(length))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  const status = range ? 206 : 200

  if (length === 0) {
    auditFetched(request, tenantId, hash, record, { range: rangeHeader, bytes: 0, status, mode: 'stream' })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(0), { status, headers })
  }
  if (request.method === 'HEAD') {
    auditFetched(request, tenantId, hash, record, { range: rangeHeader, bytes: 0, status, mode: 'stream' })
    return new Response(null, { status, headers })
  }

  const node = createReadStream(path, { start, end })
  const web = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>
  const body = meterStream(web, (bytes, completed) =>
    auditFetched(request, tenantId, hash, record, { range: rangeHeader, bytes, status, mode: 'stream', completed }),
  )
  return new Response(body, { status, headers })
}

async function serveRemote(
  request: NextRequest,
  tenantId: string,
  hash: string,
  record: DownloadLinkRecord,
  config: Awaited<ReturnType<typeof getStorageSettings>>['config'],
): Promise<Response> {
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new AppError(STORAGE_MESSAGES.PROVIDER_NOT_CONFIGURED, 422, ErrorCode.VALIDATION_ERROR)
  }
  // A fresh 60 s SigV4 URL either way: the redirect target, or what we stream from.
  const signed = presignS3GetUrl(config, record.key, 60)
  const rangeHeader = request.headers.get('range')

  if (record.redirectAllowed) {
    auditFetched(request, tenantId, hash, record, { range: rangeHeader, bytes: null, status: 302, mode: 'redirect' })
    return new Response(null, { status: 302, headers: { Location: signed, 'Cache-Control': 'private, no-store' } })
  }

  const upstreamHeaders: Record<string, string> = {}
  if (rangeHeader) upstreamHeaders.Range = rangeHeader
  const upstream = await storageFetch(signed, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: upstreamHeaders })
  if (upstream.status === 404 || upstream.status === 403) throw notFound()
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
    Logger.warn(`storage link upstream returned ${upstream.status}`)
    throw new AppError('Failed to fetch the file', 502, ErrorCode.INTERNAL_ERROR)
  }

  const headers = baseHeaders(record)
  for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(name)
    if (v) headers.set(name, v)
  }
  if (!record.contentType) {
    const ct = upstream.headers.get('content-type')
    if (ct) headers.set('Content-Type', ct)
  }
  if (!upstream.body || request.method === 'HEAD') {
    auditFetched(request, tenantId, hash, record, { range: rangeHeader, bytes: 0, status: upstream.status, mode: 'proxy' })
    return new Response(null, { status: upstream.status, headers })
  }
  const body = meterStream(upstream.body, (bytes, completed) =>
    auditFetched(request, tenantId, hash, record, {
      range: rangeHeader, bytes, status: upstream.status, mode: 'proxy', completed,
    }),
  )
  return new Response(body, { status: upstream.status, headers })
}

/** Entry point used by the route handler (GET and HEAD). */
export async function serveDownloadLink(request: NextRequest, tenantId: string, token: string): Promise<Response> {
  await Limiter.checkRateLimit(request, 'api')
  const { hash, record } = await authorizeLink(request, tenantId, token)

  const { providerName, config } = await getStorageSettings(tenantId)
  if (providerName === 'local') {
    // Same resolution `getPresignedUrl` uses for the local provider.
    const { provider } = await getProvider(tenantId, 'local')
    // The in-tree disk provider answers with the real path (a missing object or a link out of its directory is the uniform 404);
    // a plugin answering to the key `local` hands out a file:// object URL.
    const realPath = provider.getServerPath ? await provider.getServerPath(record.key) : null
    if (provider.getServerPath && !realPath) throw notFound()
    const fileUrl = realPath ? pathToFileURL(realPath).href : provider.getFileUrl(record.key)
    if (!fileUrl.startsWith('file://')) throw notFound()
    return serveLocal(request, tenantId, hash, record, fileUrl)
  }
  return serveRemote(request, tenantId, hash, record, config)
}
