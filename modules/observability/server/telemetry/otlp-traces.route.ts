import { NextRequest } from 'next/server'
import { handleOtlp } from './otlp.route.shared'

/**
 * POST /api/telemetry/otlp/v1/traces: OTLP/HTTP (traces), JSON or protobuf, optionally gzip. Authenticated by a tenant ingest key
 * (`Authorization: Bearer <key>`, scope `telemetry:write`); the workspace in the URL is NOT trusted, the tenant is the key's.
 */
export async function POST(request: NextRequest) {
  return handleOtlp('traces', request)
}
