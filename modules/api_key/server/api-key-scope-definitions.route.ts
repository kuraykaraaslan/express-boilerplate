import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyScopeDefinitionService from '@kuraykaraaslan-labs/api_key/server/api_key.scope-definition.service';
import { CreateScopeDefinitionDTO, ListScopeDefinitionsDTO } from '@kuraykaraaslan-labs/api_key/server/api_key.dto';
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET  /tenant/[tenantId]/api/api-keys/scope-definitions — list (ADMIN+)
 * POST /tenant/[tenantId]/api/api-keys/scope-definitions — create (ADMIN+)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.scope_definitions.read', scope: 'TENANT' });
    const sp = new URL(request.url).searchParams;
    const query = readListQuery(sp, ListScopeDefinitionsDTO);
    const { data, total } = await ApiKeyScopeDefinitionService.list(tenantId, query);
    return NextResponse.json({ data, total });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.scope_definitions.create', scope: 'TENANT' });
    const dto = CreateScopeDefinitionDTO.parse(await request.json());
    const item = await ApiKeyScopeDefinitionService.create(tenantId, dto);
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
