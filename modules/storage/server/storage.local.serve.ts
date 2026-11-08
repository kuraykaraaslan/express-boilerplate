import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { assertTenantObjectKey } from './storage.operations'
import { parseRange } from './storage.links.serve'
import { getLocalStorageConfig } from './storage.local.config'
import { resolveExisting } from './storage.local.fs'
import { isPublicKey, verifyLocalSignature } from './storage.local.signing'

/**
 * Serves `GET|HEAD /tenant/[tenantId]/api/storage/local/object?key=&exp=&sig=`: one object of the local disk to whoever holds its
 * signed URL. No session: the signature (storage.local.signing.ts) is the credential, bound to the tenant of the path and to the
 * key. Every refusal, a bad or expired signature, a key of another tenant, a missing file, a link out of the base directory, is the
 * SAME 404, so a prober learns nothing about which it was. Rate limited per IP before anything is checked.
 *
 * What a browser may do with it: only images, audio and video render inline (a PDF is a download: browsers do not run their PDF viewer under the sandbox CSP); everything else, and anything whose type the
 * extension does not name, is a download (`attachment`, `application/octet-stream`). html, svg and xml never render from this origin.
 * `nosniff` and a `sandbox` CSP are always set.
 */

const notFound = () => new AppError('Object not found', 404, ErrorCode.NOT_FOUND)

/** Inline-safe types by extension. Anything else is served as an opaque download. */
export const INLINE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm',
}

/** `Content-Type` and `Content-Disposition` for a key. */
export function typeHeadersFor(key: string): { contentType: string; disposition: string } {
  const base = path.posix.basename(key)
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  const inline = INLINE_TYPES[ext]
  // The name is only a hint for the browser's save dialog: ASCII-safe, quotes and separators out.
  const name = base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file'
  return inline
    ? { contentType: inline, disposition: `inline; filename="${name}"` }
    : { contentType: 'application/octet-stream', disposition: `attachment; filename="${name}"` }
}

export async function serveLocalObject(request: NextRequest, tenantId: string): Promise<Response> {
  await Limiter.checkRateLimit(request)
  const params = new URL(request.url).searchParams
  const key = params.get('key')
  const verdict = verifyLocalSignature(tenantId, { key, exp: params.get('exp'), sig: params.get('sig') })
  if (verdict !== 'ok' || !key) throw notFound()
  try { assertTenantObjectKey(tenantId, key) } catch { throw notFound() }

  // Resolved through the provider's configuration so a changed directory applies at once; the lookup refuses links out of it.
  const { dir } = await getLocalStorageConfig()
  const real = await resolveExisting(dir, key)
  if (!real) throw notFound()
  const st = await stat(real)
  const size = st.size

  const { contentType, disposition } = typeHeadersFor(key)
  const etag = `W/"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Accept-Ranges': 'bytes',
    'Cache-Control': isPublicKey(key) ? 'public, max-age=86400' : 'private, max-age=300',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
  })

  const rangeHeader = request.headers.get('range')
  const range = parseRange(rangeHeader, size)
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  if (!range && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const length = size === 0 ? 0 : end - start + 1
  headers.set('Content-Length', String(length))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  const status = range ? 206 : 200
  if (length === 0 || request.method === 'HEAD') return new Response(request.method === 'HEAD' ? null : new Uint8Array(0), { status, headers })
  const body = Readable.toWeb(createReadStream(real, { start, end })) as unknown as ReadableStream<Uint8Array>
  return new Response(body, { status, headers })
}

