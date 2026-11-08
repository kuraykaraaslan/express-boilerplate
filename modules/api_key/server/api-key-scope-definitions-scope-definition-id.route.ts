import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyScopeDefinitionService from '@kuraykaraaslan-labs/api_key/server/api_key.scope-definition.service';
import { UpdateScopeDefinitionDTO } from '@kuraykaraaslan-labs/api_key/server/api_key.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

type Ctx = { params: Promise<{ tenantId: string; scopeDefinitionId: string }> };

async function auth(request: NextRequest, tenantId: string, requiredPermission: string) {
  await authorizeRequest({ request, tenantId, requiredPermission, scope: 'TENANT' });
}

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, scopeDefinitionId } = await params;
    await Limiter.checkRateLimit(request);
    await auth(request, tenantId, 'api_key.scope_definitions.read');
    const item = await ApiKeyScopeDefinitionService.getById(tenantId, scopeDefinitionId);
    return NextResponse.json({ item });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, scopeDefinitionId } = await params;
    await Limiter.checkRateLimit(request);
    await auth(request, tenantId, 'api_key.scope_definitions.update');
    const dto = UpdateScopeDefinitionDTO.parse(await request.json());
    const item = await ApiKeyScopeDefinitionService.update(tenantId, scopeDefinitionId, dto);
    return NextResponse.json({ item });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, scopeDefinitionId } = await params;
    await Limiter.checkRateLimit(request);
    await auth(request, tenantId, 'api_key.scope_definitions.delete');
    await ApiKeyScopeDefinitionService.delete(tenantId, scopeDefinitionId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return normalizeError(e);
  }
}
