import { NextRequest } from 'next/server'
import { handleOtlp, handlePreflight } from './otlp.route.shared'

/**
 * POST /api/telemetry/otlp/v1/metrics: OTLP/HTTP (metrics), JSON or protobuf, optionally gzip. Authenticated by a tenant ingest key
 * (`Authorization: Bearer <key>`, scope `telemetry:write`, or the public browser scope `telemetry:browser:write`, which is narrower); the workspace in the URL is NOT trusted, the tenant is the key's.
 */
export async function POST(request: NextRequest) {
  return handleOtlp('metrics', request)
}

/** OPTIONS: the CORS preflight of the browser snippet (it decides nothing; the key and its Origin allow-list are checked on the POST). */
export async function OPTIONS(request: NextRequest) {
  return handlePreflight(request)
}
