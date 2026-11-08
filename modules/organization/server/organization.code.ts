import type { EntityManager, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ORGANIZATION_MESSAGES } from './organization.messages'
import {
  ORGANIZATION_SETTING_DEFAULTS,
  type OrganizationSettingKey,
} from './organization.setting.keys'

/**
 * Tenant-configurable code prefix, falling back to the module default when the
 * key is unset or blank. Mirrors `commerce_order.resolveNumberPrefix`: a
 * settings read must never be able to fail a create, so the lookup is
 * catch-to-default.
 */
export async function resolveCodePrefix(
  tenantId: string,
  key: OrganizationSettingKey,
): Promise<string> {
  const settings = await SettingService.getByKeys(tenantId, [key]).catch(
    () => ({}) as Record<string, string>,
  )
  // organization.32: a resolved answer of the wrong shape (nothing, a number, an object) is a default too, not a TypeError.
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[key] : undefined
  const configured = typeof raw === 'string' ? raw.trim() : ''
  return configured.length > 0 && configured.length <= 20 && !/[\s\u0000-\u001f]/.test(configured) ? configured : ORGANIZATION_SETTING_DEFAULTS[key]
}

/**
 * Next free `<prefix><0001>` code for a tenant. Starts from the live row count
 * and probes forward, because soft-deleted rows free their code but still shift
 * the count; the partial unique index is the real arbiter, this only avoids the
 * obvious collision.
 */
/**
 * Serialise one tenant's writes to one organization table's invariant — its
 * `count + 1` code sequence, its single default / headquarters row — on the
 * caller's transaction (docs/phases/10-db Faz 3). Without it, two concurrent creates
 * computed the same code (the loser a 409/500) and two concurrent "make me
 * the default" writes demoted each other, leaving the tenant with none or
 * failing on the partial unique index.
 */
export async function lockTenantKind(
  qr: { manager: EntityManager },
  tenantId: string,
  kind: 'legal_entity' | 'legal_entity_projection' | 'site' | 'cost_center' | 'team',
): Promise<void> {
  await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`organization:${kind}:${tenantId}`])
}

export async function allocateCode<T extends ObjectLiteral>(
  repo: Repository<T>,
  tenantId: string,
  prefix: string,
): Promise<string> {
  const existing = await repo.count({ where: { tenantId } as unknown as FindOptionsWhere<T> })
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const code = `${prefix}${String(existing + attempt).padStart(4, '0')}`
    const clash = await repo.findOne({ where: { tenantId, code } as unknown as FindOptionsWhere<T> })
    if (!clash) return code
  }
  throw new AppError(ORGANIZATION_MESSAGES.CODE_GENERATION_FAILED, 500, ErrorCode.INTERNAL_ERROR)
}

/**
 * Guard the "code is unique per tenant among non-deleted rows" invariant in the
 * service layer, so the client gets a 409 with a message instead of a raw
 * Postgres unique-violation 500. `selfId` exempts the row being updated.
 */
export async function assertCodeFree<T extends ObjectLiteral>(
  repo: Repository<T>,
  tenantId: string,
  code: string,
  primaryKey: keyof T & string,
  selfId?: string,
): Promise<void> {
  const clash = await repo.findOne({ where: { tenantId, code } as unknown as FindOptionsWhere<T> })
  if (clash && clash[primaryKey] !== selfId) {
    throw new AppError(ORGANIZATION_MESSAGES.CODE_TAKEN, 409, ErrorCode.CONFLICT)
  }
}
