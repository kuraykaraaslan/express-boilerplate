import { NextRequest } from 'next/server';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { serveDownloadLink } from '@kuraykaraaslan-labs/storage/server/storage.links.serve';

type Params = { params: Promise<{ tenantId: string; token: string }> };

/**
 * GET /tenant/[tenantId]/api/storage/links/[token]
 * Fetch an app-signed machine download link (docs/phases/15-storage/01). No session:
 * possession of the token is the authorization. Rate-limited per IP (and per
 * tenant plan) before the lookup; supports `Range`; unknown/expired/revoked
 * links are a uniform 404. `?aud=` must match an audience-bound link.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, token } = await params;
    return await serveDownloadLink(request, tenantId, token);
  } catch (e) {
    return normalizeError(e);
  }
}

/** HEAD: same checks and headers as GET, no body (devices probe size before resuming). */
export async function HEAD(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, token } = await params;
    return await serveDownloadLink(request, tenantId, token);
  } catch (e) {
    return normalizeError(e);
  }
}
