import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { WEB_VITALS_SNIPPET } from './web-vitals.snippet'

const hash = (alg: 'sha256' | 'sha384') => createHash(alg).update(WEB_VITALS_SNIPPET).digest()
/** `ETag` and the integrity value a page puts in `<script integrity>`: both derived from the source, so a change of the snippet changes both. */
export const WEB_VITALS_ETAG = `"${hash('sha256').toString('hex').slice(0, 32)}"`
export const WEB_VITALS_INTEGRITY = `sha384-${hash('sha384').toString('base64')}`

/**
 * The headers of the snippet, written out because a script served from one origin and run by pages of other origins needs exactly these:
 *  - a JavaScript type and `nosniff`, so a browser never runs it as anything else;
 *  - `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`, so `<script crossorigin integrity=...>` (subresource
 *    integrity) works from any site, and so a page under `Cross-Origin-Embedder-Policy` can load it;
 *  - a public cache of an hour with a day of stale-while-revalidate, and an ETag, so a visitor does not fetch it on every page view.
 */
export const WEB_VITALS_HEADERS: Record<string, string> = {
  'Content-Type': 'text/javascript; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  'Content-Length': String(Buffer.byteLength(WEB_VITALS_SNIPPET)),
  ETag: WEB_VITALS_ETAG,
}

/**
 * GET /api/telemetry/web-vitals: the browser snippet, static and public (it holds no secret and no tenant data; the key is supplied by the
 * page). Rate limited like any public route. `If-None-Match` answers 304.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api')
    if (request.headers.get('if-none-match') === WEB_VITALS_ETAG) {
      const { 'Content-Length': _len, 'Content-Type': _type, ...h } = WEB_VITALS_HEADERS
      void _len; void _type
      return new NextResponse(null, { status: 304, headers: h })
    }
    return new NextResponse(WEB_VITALS_SNIPPET, { status: 200, headers: WEB_VITALS_HEADERS })
  } catch (e) { return normalizeError(e) }
}
