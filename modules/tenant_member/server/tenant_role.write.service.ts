import 'reflect-metadata';
import type { QueryRunner } from 'typeorm';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { TenantRole as TenantRoleEntity } from './entities/tenant_role.entity';
import { TenantMember as TenantMemberEntity } from './entities/tenant_member.entity';
import { TENANT_ROLE_MESSAGES as MSG } from './tenant_role.messages';
import type { CreateRoleInput, UpdateRoleInput, SetGrantInput } from './tenant_role.dto';
import type { RoleView } from './tenant_role.types';
import { synthesizeBuiltins, toView } from './tenant_role.helpers';
import { holdsSensitive, ownerOnlyMatrixChanges, roleUpdateNeedsOwner } from './tenant_role.owner-only';
import { deliverRoleSetDrop, recordRoleSetDrop } from './tenant_role.cache';

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Every write to a tenant's role set runs under one tenant-wide lock (and a
 * member's `roleKeys` assignment takes it too). The matrix Save is a
 * read-modify-write of each role's permission array: two admins saving at once
 * used to lose one save — including a REVOKED sensitive permission silently
 * coming back. First-time seeding raced the same way (two copies of the
 * built-ins), and a group deleted mid-assignment could be re-attached.
 */
export const roleSetLock = (tenantId: string) => `tenant_role:set:${tenantId}`;

async function roleSetWrite<T>(tenantId: string, fn: (qr: QueryRunner) => Promise<T>): Promise<T> {
  const { out, drops } = await withTenantTransactionFor(tenantId, async (qr) => {
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [roleSetLock(tenantId)]);
    const out = await fn(qr);
    // D253: the role set's cache drop commits with the write (a permission taken from a role, a group deleted, holds on every node at
    // once, also when Redis is away now); delivered right after the commit, else by the session_end relay.
    return { out, drops: await recordRoleSetDrop(qr, tenantId) };
  });
  await deliverRoleSetDrop(tenantId, drops);
  return out;
}

/** Postgres unique_violation, however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/**
 * Ensure the tenant's built-in roles are persisted (copy-on-write). Called
 * before any grant edit so that, once a tenant touches access control, the
 * whole role-set is authoritative from the DB rather than the static matrix.
 */
async function ensureSeeded(
  qr: QueryRunner,
  tenantId: string,
  actorId?: string,
): Promise<void> {
  const repo = qr.manager.getRepository(TenantRoleEntity);
  const count = await repo.count({ where: { tenantId } });
  if (count > 0) return;
  const rows = synthesizeBuiltins().map((r) =>
    repo.create({
      tenantId,
      key: r.key,
      label: r.label,
      description: r.description,
      permissions: r.permissions,
      isBuiltin: true,
      isActive: true,
      createdByUserId: actorId ?? null,
    }),
  );
  await repo.save(rows);
}

/**
 * Apply a batch of grant changes (the matrix "Save"). `isOwner` gates
 * sensitive permissions / the OWNER column against non-owner admins.
 */
export async function saveMatrix(
  tenantId: string,
  changes: SetGrantInput[],
  opts: { isOwner: boolean; actorId?: string },
): Promise<void> {
  if (changes.length === 0) return;

  // Group changes by role to minimise row writes.
  const byRole = new Map<string, SetGrantInput[]>();
  for (const c of changes) {
    const list = byRole.get(c.roleKey) ?? [];
    list.push(c);
    byRole.set(c.roleKey, list);
  }

  // One transaction: the whole Save lands or none of it does.
  await roleSetWrite(tenantId, async (qr) => {
    await ensureSeeded(qr, tenantId, opts.actorId);
    const repo = qr.manager.getRepository(TenantRoleEntity);
    const rows = new Map<string, TenantRoleEntity>();
    for (const roleKey of byRole.keys()) {
      const row = await repo.findOne({ where: { tenantId, key: roleKey } });
      if (!row) throw new AppError(MSG.ROLE_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      rows.set(roleKey, row);
    }
    // Privilege-escalation gate before any write, against the rows as stored under the lock (05-tenant-member 2.2): a
    // non-owner is refused only an OWNER-column or sensitive cell they would actually change.
    if (!opts.isOwner && ownerOnlyMatrixChanges(changes, [...rows.values()]).length) {
      throw new AppError(MSG.OWNER_ONLY, 403, ErrorCode.FORBIDDEN);
    }
    for (const [roleKey, roleChanges] of byRole) {
      const row = rows.get(roleKey)!;
      const set = new Set(row.permissions ?? []);
      for (const c of roleChanges) {
        if (c.granted) set.add(c.permissionId);
        else set.delete(c.permissionId);
      }
      await repo.update({ tenantId, key: roleKey }, { permissions: [...set] });
    }
  });

  audit(tenantId, opts.actorId, 'tenant_role.matrix_saved', 'matrix', {
    changeCount: changes.length,
    roles: [...byRole.keys()],
  });
}

// ── Custom groups ────────────────────────────────────────────────────────

export async function createRole(
  tenantId: string,
  input: CreateRoleInput,
  opts: { isOwner: boolean; actorId?: string },
): Promise<RoleView> {
  if (input.key === 'OWNER' || input.key === 'ADMIN' || input.key === 'USER') {
    throw new AppError(MSG.ROLE_KEY_TAKEN, 409, ErrorCode.CONFLICT);
  }
  if (!opts.isOwner && holdsSensitive(input.permissions)) {
    throw new AppError(MSG.OWNER_ONLY, 403, ErrorCode.FORBIDDEN);
  }
  let saved: TenantRoleEntity;
  try {
    saved = await roleSetWrite(tenantId, async (qr) => {
  await ensureSeeded(qr, tenantId, opts.actorId);
  const repo = qr.manager.getRepository(TenantRoleEntity);
  const existing = await repo.findOne({ where: { tenantId, key: input.key } });
  if (existing) throw new AppError(MSG.ROLE_KEY_TAKEN, 409, ErrorCode.CONFLICT);

  const row = repo.create({
    tenantId,
    key: input.key,
    label: input.label,
    description: input.description ?? null,
    permissions: input.permissions,
    isBuiltin: false,
    isActive: true,
    createdByUserId: opts.actorId ?? null,
  });
  return repo.save(row);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(MSG.ROLE_KEY_TAKEN, 409, ErrorCode.CONFLICT);
    throw err;
  }
  audit(tenantId, opts.actorId, 'tenant_role.created', input.key, { label: input.label });
  return toView(saved);
}

export async function updateRole(
  tenantId: string,
  roleKey: string,
  input: UpdateRoleInput,
  opts: { isOwner: boolean; actorId?: string },
): Promise<RoleView> {
  const saved = await roleSetWrite(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantRoleEntity);
    const row = await repo.findOne({ where: { tenantId, key: roleKey } });
    if (!row) throw new AppError(MSG.ROLE_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    // Built-in identity (key/label) is immutable; only grants/active may change.
    if (row.isBuiltin && (input.label !== undefined || input.description !== undefined)) {
      throw new AppError(MSG.BUILTIN_IMMUTABLE, 400, ErrorCode.VALIDATION_ERROR);
    }
    // 05-tenant-member 2.2 / 3.2: compared against the stored row, not the input alone.
    if (!opts.isOwner && roleUpdateNeedsOwner(roleKey, row, input)) {
      throw new AppError(MSG.OWNER_ONLY, 403, ErrorCode.FORBIDDEN);
    }
    // Only the edited columns: a whole-row save of this read would write back
    // a permission set another admin's Save just changed.
    const patch: Partial<TenantRoleEntity> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.description !== undefined) patch.description = input.description;
    if (input.permissions !== undefined) patch.permissions = input.permissions;
    if (input.isActive !== undefined && !row.isBuiltin) patch.isActive = input.isActive;
    if (Object.keys(patch).length) await repo.update({ tenantId, key: roleKey }, patch);
    return Object.assign(row, patch);
  });
  audit(tenantId, opts.actorId, 'tenant_role.updated', roleKey, { changed: Object.keys(input) });
  return toView(saved);
}

/**
 * Delete a custom group — and take it off everybody who held it.
 *
 * The assignments have to go in the same transaction as the row. Leaving them
 * behind was never a *grant* (a deleted group resolves to no permissions:
 * `permissionsFor` skips unknown keys and the role cache is dropped below), but
 * it was a name on a member record that no screen in the product could explain,
 * and a group later re-created under the same key would silently re-grant it to
 * whoever still carried the string. Both are the same bug: a membership must
 * not outlive the thing it is a membership of.
 *
 * Sessions are deliberately NOT bumped. `sessionVersion` is how the product
 * force-logs-somebody-out, and it is far too blunt here: the permissions are
 * already gone the moment the cache is invalidated, so signing every holder out
 * of every device would be punishment without a security reason.
 */
export async function deleteRole(
  tenantId: string,
  roleKey: string,
  opts: { actorId?: string; isOwner?: boolean },
): Promise<{ unassignedMembers: number }> {
  const unassignedMembers = await roleSetWrite(tenantId, async (qr) => {
    const row = await qr.manager.getRepository(TenantRoleEntity).findOne({ where: { tenantId, key: roleKey } });
    if (!row) throw new AppError(MSG.ROLE_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (row.isBuiltin) throw new AppError(MSG.BUILTIN_IMMUTABLE, 400, ErrorCode.VALIDATION_ERROR);
    // 05-tenant-member 3.2: deleting a group that holds a sensitive permission revokes it from every holder, which the
    // matrix allows only the OWNER. Fails closed: a caller that does not say it is the owner is not.
    if (opts.isOwner !== true && holdsSensitive(row.permissions)) {
      throw new AppError(MSG.OWNER_ONLY, 403, ErrorCode.FORBIDDEN);
    }
    const memberRepo = qr.manager.getRepository(TenantMemberEntity);
    const holders = await memberRepo
      .createQueryBuilder('m')
      .where('m."tenantId" = :tenantId', { tenantId })
      // jsonb containment rather than loading every member of the tenant: the
      // groups are a needle, the member table is the haystack.
      .andWhere('m."roleKeys" @> :key::jsonb', { key: JSON.stringify([roleKey]) })
      .setLock('pessimistic_write')
      .getMany();
    for (const holder of holders) {
      await memberRepo.update(
        { tenantMemberId: holder.tenantMemberId, tenantId },
        { roleKeys: (holder.roleKeys ?? []).filter((k) => k !== roleKey) },
      );
    }
    await qr.manager.getRepository(TenantRoleEntity).delete({ tenantId, key: roleKey });
    return holders.length;
  });

  audit(tenantId, opts.actorId, 'tenant_role.deleted', roleKey, { unassignedMembers });
  return { unassignedMembers };
}

/**
 * How many members sit in each role, built-in and custom alike.
 *
 * Two different columns answer this: `memberRole` for the built-ins and the
 * `roleKeys` array for the groups. They are counted in one statement because a
 * screen that shows both columns side by side must not be able to show them
 * from two different instants.
 */
export async function memberCounts(tenantId: string): Promise<Record<string, number>> {
  const rows: Array<{ key: string; count: string }> = await withTenantTransactionFor(tenantId, (qr) => qr.query(
    // Soft-deleted memberships are excluded on both branches: a removed member
    // is not somebody the roles screen should count before a delete.
    `SELECT "memberRole" AS key, COUNT(*)::text AS count
       FROM "tenant_members"
      WHERE "tenantId" = $1 AND "deletedAt" IS NULL
      GROUP BY "memberRole"
     UNION ALL
     SELECT k AS key, COUNT(*)::text AS count
       FROM "tenant_members" m, jsonb_array_elements_text(m."roleKeys") AS k
      WHERE m."tenantId" = $1 AND m."deletedAt" IS NULL
      GROUP BY k`,
    [tenantId],
  ));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = (out[r.key] ?? 0) + Number(r.count);
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function audit(
  tenantId: string,
  actorId: string | undefined,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): void {
  AuditLogService.log({
    tenantId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorId: actorId ?? null,
    action,
    resourceType: 'tenant_role',
    resourceId,
    metadata: { tenantId, ...metadata },
  });
}
