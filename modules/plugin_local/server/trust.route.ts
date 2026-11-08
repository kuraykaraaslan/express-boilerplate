// path: app/tenant/[ROOT]/api/plugin_local/trust/route.ts  (ROOT operator only)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { readTrustPolicy, writeTrustPolicy } from './plugin_local.trust';
import { TrustPolicyDTO, notFoundResponse, parseJsonBody } from './plugin_local.dto';

/** GET — the trust policy: trusted signing keys, whether signatures are required, the limit ceiling. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    if (!isRootTenant(tenantId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    return NextResponse.json({ success: true, trust: await readTrustPolicy() });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PUT { trustedKeys?, requireSigned?, maxLimits? } — replace the parts given. Keys must be Ed25519 SPKI. Audited. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    if (!isRootTenant(tenantId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    const parsed = await parseJsonBody(request, TrustPolicyDTO);
    if (!parsed.ok) return parsed.response;
    return NextResponse.json({ success: true, trust: await writeTrustPolicy(parsed.data, user?.userId) });
  } catch (e) {
    return normalizeError(e);
  }
}
