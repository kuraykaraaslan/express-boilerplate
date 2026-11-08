// path: app/tenant/[tenantId]/api/domains/[domainId]/ssl-check/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantDomainService from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { acmeConfig } from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.acme.config";

/**
 * POST /tenant/[tenantId]/api/domains/[domainId]/ssl-check
 * Force an on-demand TLS handshake + SSL status reconciliation for one domain.
 * Surfaces the daily SSL cron's probe logic for a single tenant-scoped row.
 *
 * Phase 51: when the platform orders its own certificates (ACME_DIRECTORY_URL set) nothing is probed inside the request: a handshake probe
 * (and an order when no good certificate is held) goes on the certificate queue and the answer is `{ success, queued }` with 202; the page
 * reloads the status a little later. Otherwise the inline probe runs as before.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; domainId: string }> }
) {
  try {
    const { tenantId, domainId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.ssl_check', scope: 'TENANT' });

    if (acmeConfig()) {
      const { requestCertificateCheck } = await import('@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.certificates.view');
      const { queued } = await requestCertificateCheck(tenantId, domainId);
      return NextResponse.json({ success: true, queued }, { status: 202 });
    }

    const ssl = await TenantDomainService.recheckDomainSsl(tenantId, domainId);

    return NextResponse.json({ success: true, ssl });
  } catch (e) {
    return normalizeError(e);
  }
}
