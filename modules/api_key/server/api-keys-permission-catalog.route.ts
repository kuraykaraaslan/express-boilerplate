import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { heldPermissions } from '@kuraykaraaslan-labs/api_key/server/api_key.grant.next';
import { isReadOnlyPermission, tenantKeyCatalog } from '@kuraykaraaslan-labs/api_key/server/api_key.permissions';
import { getTenantPolicy, maxKeyTtlDays } from '@kuraykaraaslan-labs/api_key/server/api_key.policy';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/api-keys/permission-catalog
 * What the caller may give an API key (docs/phases/48-api-key-scopes D11, D12): the permissions a key may hold, of the modules
 * enabled for the tenant, that the caller holds now, grouped by module, each marked read-only or not (the module's "Read
 * only" preset). The picker of the create screen and of the key's page; the create and edit routes check again.
 * `maxTtlDays` is the furthest a new key may expire, in days (365, or the tenant's lower cap), so the create screen's date
 * stays within what the server accepts; left out when the policy cannot be read (the create answers for itself then).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.create', scope: 'TENANT' });

    const catalog = await tenantKeyCatalog(tenantId);
    const held = await heldPermissions(request, tenantId, auth, catalog.map((p) => p.id));
    const byModule = new Map<string, Array<{ id: string; name: string; description?: string; group?: string; readOnly: boolean }>>();
    for (const p of catalog) {
      if (!held.has(p.id)) continue;
      const list = byModule.get(p.moduleId) ?? [];
      list.push({ id: p.id, name: p.name, description: p.description, group: p.group, readOnly: isReadOnlyPermission(p.id) });
      byModule.set(p.moduleId, list);
    }
    const modules = [...byModule.entries()]
      .map(([moduleId, permissions]) => ({
        moduleId,
        name: moduleRegistry.getModule(moduleId)?.name ?? moduleId,
        permissions: permissions.sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const maxTtlDays = await getTenantPolicy(tenantId).then(maxKeyTtlDays, () => undefined);
    return NextResponse.json({ modules, ...(maxTtlDays ? { maxTtlDays } : {}) }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
