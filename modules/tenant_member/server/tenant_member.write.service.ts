import 'reflect-metadata';
import { In, IsNull, Not } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { getDataSource, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { TenantMember as TenantMemberEntity } from './entities/tenant_member.entity';
import { SafeTenantMember, SafeTenantMemberSchema } from './tenant_member.types';
import { CreateTenantMemberInput, UpdateTenantMemberInput } from './tenant_member.dto';
import TenantMemberMessages from './tenant_member.messages';
import { TenantMemberRoleEnum, TenantMemberStatusEnum } from './tenant_member.enums';
import type { TenantMemberRole } from './tenant_member.enums';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { resolveDefaultRole } from './tenant_member.helpers';
import { ROLE_RANK, rankOf } from './tenant_member.rank';
import { TenantRole as TenantRoleEntity } from './entities/tenant_role.entity';
import { roleSetLock } from './tenant_role.write.service';
import { holdsSensitive } from './tenant_role.owner-only';
import { notifyMembershipEnded } from './tenant_member.membership-ended';
import { notifyAccessChanged } from './tenant_member.access-changed';
import { recordSessionEndInTx, type SessionEndInTx } from '@kuraykaraaslan-labs/session_end/server/session_end.in-tx';

/**
 * The tenant's owner set is guarded by one tenant-wide lock: every write that
 * can take an ACTIVE owner away (demote, deactivate, suspend, remove,
 * transfer) takes it and then counts. Without it two concurrent demotions of
 * a tenant's two owners each saw the other one still there, and the tenant was
 * left with none. The key is shared with scim's group→role recompute.
 */
export const ownersLock = (tenantId: string) => `tenant:owners:${tenantId}`;

/** D249: what a membership hook is told of the orders its change's transaction already recorded (nothing when none was). */
function orderedBy(ends: SessionEndInTx | null, tenantId: string): { sessionEndOrderedBy?: string[] } {
  const by = ends?.orderedBy(tenantId) ?? [];
  return by.length ? { sessionEndOrderedBy: by } : {};
}

async function lockOwners(qr: QueryRunner, tenantId: string): Promise<void> {
  await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownersLock(tenantId)]);
}

/** Active owners other than `exceptMemberId`. */
async function otherActiveOwners(qr: QueryRunner, tenantId: string, exceptMemberId: string): Promise<number> {
  return qr.manager.getRepository(TenantMemberEntity).count({
    where: { tenantId, memberRole: 'OWNER', memberStatus: 'ACTIVE', deletedAt: IsNull(), tenantMemberId: Not(exceptMemberId) },
  });
}

/** Postgres unique_violation, however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

// ── Cross-cutting side effects (audit_log + member notification) ─────────────

/**
 * Write a membership-change entry to the shared audit_log. Fire-and-forget:
 * `AuditLogService.log` never throws (it swallows + logs its own failures), so
 * auditing can never break a membership mutation. Mirrors the audit usage in
 * `tenant_role.service`.
 */
function auditMember(
  tenantId: string,
  actorId: string | undefined,
  action: string,
  tenantMemberId: string,
  metadata: Record<string, unknown>,
): void {
  AuditLogService.log({
    tenantId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorId: actorId ?? null,
    action,
    resourceType: 'tenant_member',
    resourceId: tenantMemberId,
    metadata: { tenantId, ...metadata },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Best-effort email to a member when their role/status changed. Resolves the
 * member's address from the system user table and enqueues via the shared mail
 * queue. Never throws — mail is a side effect, not part of the mutation
 * contract (mirrors `tenant_export`'s best-effort link email).
 */
async function notifyMemberChange(
  tenantId: string,
  userId: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  try {
    const sysDs = await getDataSource();
    const user = await sysDs.getRepository(UserEntity).findOne({ where: { userId } });
    if (!user?.email) return;
    // Through the dispatcher (PLAT-01). NORMAL, not CRITICAL: somebody changed
    // this member's role or status, which they will also see the next time they
    // open the product. CRITICAL is reserved for notices a preference must
    // never be able to silence — a lockout, a minted credential, somebody
    // acting as you — and spending it here would erode what it means there.
    const { default: NotificationService } = await import(
      '@kuraykaraaslan-labs/notification/server/notification.service'
    );
    await NotificationService.notify(
      tenantId,
      { userId, email: user.email },
      { event: 'tenant_member.changed', category: 'workspace', title: subject, body: subject, data: { html: bodyHtml } },
    );
  } catch (e) {
    Logger.warn(`[tenant_member] member-change email failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Refuse a role or status outside the enums BEFORE anything is written (tenant_member.02, fixed 2026-10-20). The
 * response schema used to be the only check, so the caller got a 400 for a row that already held the junk value.
 */
function assertMemberEnums(data: { memberRole?: unknown; memberStatus?: unknown }): void {
  if (data.memberRole != null && !TenantMemberRoleEnum.safeParse(data.memberRole).success) {
    throw new AppError('Invalid member role', 400, ErrorCode.VALIDATION_ERROR);
  }
  if (data.memberStatus != null && !TenantMemberStatusEnum.safeParse(data.memberStatus).success) {
    throw new AppError('Invalid member status', 400, ErrorCode.VALIDATION_ERROR);
  }
}

export async function create(data: CreateTenantMemberInput, actorId?: string): Promise<SafeTenantMember> {
  assertMemberEnums(data);
  // Honour the tenant's defaultMemberRole when the caller did not pin a role.
  const memberRole = data.memberRole ?? (await resolveDefaultRole(data.tenantId));
  let saved: TenantMemberEntity;
  try {
    // Serialised per (tenant, user). The (tenantId, userId) unique index also
    // covers soft-deleted rows, so re-adding someone who was removed RESTORES
    // their row — a fresh insert (an accepted invitation, a re-add) used to
    // fail with a unique violation and a 500.
    saved = await withTenantTransactionFor(data.tenantId, async (qr) => {
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tenant_member:${data.tenantId}:${data.userId}`]);
      const repo = qr.manager.getRepository(TenantMemberEntity);
      const existing = await repo.findOne({ where: { tenantId: data.tenantId, userId: data.userId }, withDeleted: true });
      if (existing && !existing.deletedAt) throw new AppError(TenantMemberMessages.MEMBER_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
      if (existing) {
        const restore = {
          memberRole, memberStatus: data.memberStatus ?? 'ACTIVE', deletedAt: null,
          suspensionReason: null, suspendedUntil: null, roleKeys: [], externalId: null,
        };
        await repo.update({ tenantMemberId: existing.tenantMemberId, tenantId: data.tenantId }, restore as never);
        // The old sessions of the old membership must not come back with it.
        await repo.increment({ tenantMemberId: existing.tenantMemberId, tenantId: data.tenantId }, 'sessionVersion', 1);
        return (await repo.findOne({ where: { tenantMemberId: existing.tenantMemberId, tenantId: data.tenantId } }))!;
      }
      return repo.save(repo.create({ ...data, memberRole } as Partial<TenantMemberEntity>));
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(TenantMemberMessages.MEMBER_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
    throw err;
  }
  await WebhookService.dispatchEvent(saved.tenantId, 'member.created', {
    tenantMemberId: saved.tenantMemberId,
    userId: saved.userId,
    memberRole: saved.memberRole,
  });
  auditMember(saved.tenantId, actorId, 'tenant_member.created', saved.tenantMemberId, {
    userId: saved.userId,
    memberRole: saved.memberRole,
    memberStatus: saved.memberStatus,
  });
  return SafeTenantMemberSchema.parse(saved);
}

/** Order-insensitive equality of two roleKeys lists. */
const sameKeys = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean =>
  [...new Set(a ?? [])].sort().join('\u0000') === [...new Set(b ?? [])].sort().join('\u0000');

/**
 * `opts.isOwner`: whether the actor is the workspace OWNER. Giving or taking a group that holds a sensitive permission is
 * owner-only and is checked here under the role-set lock (05-tenant-member 1.1); a caller that does not say is not an owner.
 */
export async function update(
  tenantMemberId: string,
  tenantId: string,
  data: UpdateTenantMemberInput,
  actorId?: string,
  opts: { isOwner?: boolean } = {},
): Promise<SafeTenantMember> {
  assertMemberEnums(data);
  const { member, updated, changed, ends } = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantMemberEntity);
    await lockOwners(qr, tenantId);
    const member = await repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!member) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    // 05-tenant-member 1.1: only what actually differs from the locked row is written. A value equal to the stored one is
    // not a change, and an update that changes nothing writes nothing and signs nobody out.
    const patch: Partial<TenantMemberEntity> = {};
    if (data.memberRole != null && data.memberRole !== member.memberRole) patch.memberRole = data.memberRole;
    if (data.memberStatus != null && data.memberStatus !== member.memberStatus) patch.memberStatus = data.memberStatus;
    if (data.roleKeys !== undefined && !sameKeys(data.roleKeys, member.roleKeys)) patch.roleKeys = [...new Set(data.roleKeys)];
    if (Object.keys(patch).length === 0) return { member, updated: member, changed: [] as string[], ends: null };

    // Taking an ACTIVE owner away — by demotion OR by deactivation — needs
    // another active owner to remain (a status change used to bypass the
    // check entirely and could lock the tenant out of itself).
    const losesOwner = member.memberRole === 'OWNER' && member.memberStatus === 'ACTIVE' && (
      (patch.memberRole && patch.memberRole !== 'OWNER') ||
      (patch.memberStatus && patch.memberStatus !== 'ACTIVE'));
    if (losesOwner && (await otherActiveOwners(qr, tenantId, tenantMemberId)) === 0) {
      throw new AppError(TenantMemberMessages.CANNOT_DEMOTE_OWNER, 409, ErrorCode.CONFLICT);
    }

    // Custom groups (phase 6.2): every key must name an ACTIVE, non-builtin group
    // in THIS tenant. Validated rather than trusted, because a dangling key is a
    // grant nobody can see in the roles screen — it would sit on the member
    // forever, granting whatever a future group of that name happens to grant.
    // Checked under the role-set lock, so a group deleted concurrently cannot
    // be written onto the member after its holders were already cleared.
    if (patch.roleKeys !== undefined) {
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [roleSetLock(tenantId)]);
      const roleRepo = qr.manager.getRepository(TenantRoleEntity);
      if (patch.roleKeys.length) {
        const rows = await roleRepo.find({
          where: { tenantId, key: In(patch.roleKeys), isBuiltin: false, isActive: true },
        });
        const assignable = new Set(rows.map((r) => r.key));
        const unknown = patch.roleKeys.filter((k) => !assignable.has(k));
        if (unknown.length) {
          throw new AppError(
            `${TenantMemberMessages.ROLE_KEY_UNKNOWN}: ${unknown.join(', ')}`,
            422, ErrorCode.VALIDATION_ERROR,
          );
        }
      }
      // 05-tenant-member 1.1: a group that holds a sensitive permission is given or taken only by an OWNER. Asked again here
      // against the stored groups, under the lock, so a group that gained a sensitive id after the route's cached read is caught.
      if (opts.isOwner !== true) {
        const before = new Set(member.roleKeys ?? []);
        const after = new Set(patch.roleKeys);
        const changedKeys = [...new Set([...before, ...after])].filter((k) => before.has(k) !== after.has(k));
        if (changedKeys.length) {
          const changedRows = await roleRepo.find({ where: { tenantId, key: In(changedKeys) } });
          if (changedRows.some((r) => holdsSensitive(r.permissions))) {
            throw new AppError(TenantMemberMessages.SENSITIVE_GROUP_OWNER_ONLY, 403, ErrorCode.FORBIDDEN);
          }
        }
      }
    }

    // Phase 55 02.6 (D55-69): an administrator who changes the status of a membership the firewall held for review (approved it, or set
    // it anything else) decided it, so the run's marker goes with the hold. Left behind, a later PENDING set by an administrator would
    // carry it, and the run's undo or expiry (`releaseReview`) would flip that membership to ACTIVE against the administrator's decision.
    const write: Partial<TenantMemberEntity> = { ...patch };
    if (patch.memberStatus !== undefined && typeof member.suspensionReason === 'string' && member.suspensionReason.startsWith(REVIEW_MARKER_PREFIX)) {
      write.suspensionReason = null;
    }
    await repo.update({ tenantMemberId, tenantId }, write);
    // Sessions are signed out only for a role or status change. A group change alone does not: its permissions follow at
    // once through the member cache dropped below (the reason deleteRole does not bump either), 05-tenant-member 1.1.
    if (patch.memberRole !== undefined || patch.memberStatus !== undefined) {
      await repo.increment({ tenantMemberId, tenantId }, 'sessionVersion', 1);
    }
    // D249: the member's session-ending orders (the websocket drops) in this transaction, for the two changes announced below
    const nowActive = (patch.memberStatus ?? member.memberStatus) === 'ACTIVE';
    const endReason = patch.memberStatus !== undefined && !nowActive ? 'membership_ended' as const
      : nowActive && (patch.memberRole !== undefined || patch.roleKeys !== undefined) ? 'access_changed' as const : null;
    const ends = endReason ? await recordSessionEndInTx(qr, { type: 'member_access_ended', tenantId, userId: member.userId, reason: endReason }) : null;
    return { member, updated: (await repo.findOne({ where: { tenantMemberId, tenantId } }))!, changed: Object.keys(patch), ends };
  });
  if (changed.length === 0) return SafeTenantMemberSchema.parse({ ...member, roleKeys: member.roleKeys ?? [] });
  await redis.del(`tenant:member:${member.userId}:${tenantId}`).catch(() => {});
  // after the member cache, so a reconnect is judged under the new membership; the relay has the orders otherwise
  await ends?.afterCommit();
  await WebhookService.dispatchEvent(tenantId, 'member.updated', {
    tenantMemberId,
    userId: updated.userId,
    memberRole: updated.memberRole,
  });
  auditMember(tenantId, actorId, 'tenant_member.updated', tenantMemberId, {
    userId: updated.userId,
    changed,
    memberRole: updated.memberRole,
    memberStatus: updated.memberStatus,
  });
  // Best-effort: tell the member when their role or status actually changed.
  const roleChanged = updated.memberRole !== member.memberRole;
  const statusChanged = updated.memberStatus !== member.memberStatus;
  if (statusChanged && updated.memberStatus !== 'ACTIVE') {
    await notifyMembershipEnded({ tenantId, userId: updated.userId, reason: String(updated.memberStatus).toLowerCase(), ...orderedBy(ends, tenantId) });
  }
  // Still a member, with different rights: what was granted once at a handshake must follow (websocket.08).
  const roleKeysChanged = !sameKeys(member.roleKeys, updated.roleKeys);
  if (updated.memberStatus === 'ACTIVE' && (roleChanged || roleKeysChanged)) {
    await notifyAccessChanged({ tenantId, userId: updated.userId, reason: roleChanged ? 'role' : 'role_keys', ...orderedBy(ends, tenantId) });
  }
  if (roleChanged || statusChanged) {
    const parts: string[] = [];
    if (roleChanged) parts.push(`role is now <strong>${updated.memberRole}</strong>`);
    if (statusChanged) parts.push(`status is now <strong>${updated.memberStatus}</strong>`);
    await notifyMemberChange(
      tenantId,
      updated.userId,
      'Your membership was updated',
      `<p>Your membership ${parts.join(' and ')}.</p>`,
    );
  }
  return SafeTenantMemberSchema.parse(updated);
}

/**
 * Suspend a member with a reason and optional auto-expiry. Bumps
 * sessionVersion so existing sessions are invalidated. OWNER cannot be
 * suspended (use ownership transfer first).
 */
export async function suspend(
  tenantMemberId: string,
  tenantId: string,
  opts: { reason: string; until?: Date | null; actorId?: string } = { reason: '' },
): Promise<SafeTenantMember> {
  // On the locked row: the OWNER check and the write see the same role.
  const { row: member, ends } = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantMemberEntity);
    const row = await repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (row.memberRole === 'OWNER') throw new AppError(TenantMemberMessages.CANNOT_DEMOTE_OWNER, 409, ErrorCode.CONFLICT);
    await repo.update({ tenantMemberId, tenantId }, {
      memberStatus: 'SUSPENDED',
      suspensionReason: opts.reason || null,
      suspendedUntil: opts.until ?? null,
    });
    await repo.increment({ tenantMemberId, tenantId }, 'sessionVersion', 1);
    // D249: the member's session-ending orders (the websocket drops) in this transaction
    const ends = await recordSessionEndInTx(qr, { type: 'member_access_ended', tenantId, userId: row.userId, reason: 'membership_ended' });
    return { row, ends };
  });
  await redis.del(`tenant:member:${member.userId}:${tenantId}`).catch(() => {});
  await ends.afterCommit();
  await WebhookService.dispatchEvent(tenantId, 'member.updated', {
    tenantMemberId, userId: member.userId, memberStatus: 'SUSPENDED', reason: opts.reason ?? null,
  }).catch(() => {});
  await notifyMembershipEnded({ tenantId, userId: member.userId, reason: 'suspended', ...orderedBy(ends, tenantId) });
  // tenant_member.10 (fixed 2026-10-20): a suspension is audited like every other membership change.
  auditMember(tenantId, opts.actorId, 'tenant_member.suspended', tenantMemberId, {
    userId: member.userId, reason: opts.reason || null, until: opts.until ? opts.until.toISOString() : null,
  });
  await notifyMemberChange(
    tenantId,
    member.userId,
    'Your membership was suspended',
    `<p>Your membership has been suspended.</p>${opts.reason ? `<p>Reason: ${escapeHtml(opts.reason)}</p>` : ''}`,
  );
  const updated = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) =>
    repo.findOne({ where: { tenantMemberId, tenantId } }));
  return SafeTenantMemberSchema.parse(updated!);
}

/** Lift a suspension (also auto-called when `suspendedUntil` has passed). */
export async function unsuspend(tenantMemberId: string, tenantId: string, actorId?: string): Promise<SafeTenantMember> {
  // Only a SUSPENDED membership is lifted. This set ACTIVE unconditionally,
  // so "unsuspend" also reactivated a member an IdP had deprovisioned
  // (INACTIVE) — bringing back access the directory had just withdrawn.
  const { member, updated } = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantMemberEntity);
    const member = await repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() } });
    if (!member) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    const res = await repo.update(
      { tenantMemberId, tenantId, memberStatus: 'SUSPENDED', deletedAt: IsNull() },
      { memberStatus: 'ACTIVE', suspensionReason: null, suspendedUntil: null },
    );
    if (!res.affected) throw new AppError(TenantMemberMessages.NOT_SUSPENDED, 409, ErrorCode.CONFLICT);
    return { member, updated: (await repo.findOne({ where: { tenantMemberId, tenantId } }))! };
  });
  await redis.del(`tenant:member:${member.userId}:${tenantId}`).catch(() => {});
  auditMember(tenantId, actorId, 'tenant_member.reactivated', tenantMemberId, { userId: member.userId });
  await notifyMemberChange(
    tenantId,
    member.userId,
    'Your membership was reactivated',
    '<p>Your membership has been reactivated and is now active.</p>',
  );
  return SafeTenantMemberSchema.parse(updated);
}

/**
 * Phase 55 02.6, sign-up protection: the AI firewall's review hold of a NEW membership (tenant_member.firewall-actions.ts
 * `tenant_member.signup_review`). An ACTIVE membership becomes PENDING (the guard and the session refresh admit only ACTIVE members, the
 * sign-in pages say "pending approval"), its sessions stop through `sessionVersion`, and the run is named in `suspensionReason` (the
 * column of why a membership does not hold: `firewall_review:<proposalId>`). An administrator approves by setting the member ACTIVE on
 * the members page (or declines by removing it); the run's undo (or its expiry) lifts only its own hold (`releaseReview`). Never the OWNER.
 */
export const REVIEW_MARKER_PREFIX = 'firewall_review:';

/** The marker a review run writes. */
export const reviewMarker = (runId: string): string => `${REVIEW_MARKER_PREFIX}${runId}`;

export async function holdForReview(tenantMemberId: string, tenantId: string, opts: { marker: string }): Promise<{ held: boolean }> {
  if (!opts.marker.startsWith(REVIEW_MARKER_PREFIX)) throw new Error(`a review marker starts with ${REVIEW_MARKER_PREFIX}`);
  const { row, held, ends } = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantMemberEntity);
    const row = await repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (row.memberRole === 'OWNER') throw new AppError(TenantMemberMessages.CANNOT_DEMOTE_OWNER, 409, ErrorCode.CONFLICT);
    // Add, never subtract: a membership an administrator suspended, deprovisioned or left pending is not this hold's.
    if (row.memberStatus !== 'ACTIVE') return { row, held: false, ends: null };
    await repo.update({ tenantMemberId, tenantId }, { memberStatus: 'PENDING', suspensionReason: opts.marker, suspendedUntil: null });
    await repo.increment({ tenantMemberId, tenantId }, 'sessionVersion', 1);
    // D249: the held member's live sockets end with its sessions (session_end:order_source, in this transaction). Only the drop:
    // membership_ended is not told (a hold may be approved, and its push registrations are the firewall's call, not this one's)
    const ends = await recordSessionEndInTx(qr, { type: 'member_access_ended', tenantId, userId: row.userId, reason: 'membership_ended' });
    return { row, held: true, ends };
  });
  if (!held) return { held: false };
  await redis.del(`tenant:member:${row.userId}:${tenantId}`).catch(() => {});
  await ends?.afterCommit();
  await WebhookService.dispatchEvent(tenantId, 'member.updated', {
    tenantMemberId, userId: row.userId, memberStatus: 'PENDING', reason: 'review',
  }).catch(() => {});
  auditMember(tenantId, undefined, 'tenant_member.review_held', tenantMemberId, { userId: row.userId, source: 'firewall' });
  await notifyMemberChange(
    tenantId,
    row.userId,
    'Your membership is waiting for review',
    '<p>An administrator of this workspace will review your new membership. You can use the workspace once it is approved.</p>',
  );
  return { held: true };
}

/**
 * Lifts a review hold, only while it is still the run's own (PENDING with the run's marker; one conditional update): an administrator who
 * approved, declined or changed the membership since decided it, and nothing is lifted. Answers whether one was lifted.
 */
export async function releaseReview(tenantMemberId: string, tenantId: string, marker: string): Promise<boolean> {
  if (!marker.startsWith(REVIEW_MARKER_PREFIX)) return false;
  const row = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantMemberEntity);
    const res = await repo.update(
      { tenantMemberId, tenantId, memberStatus: 'PENDING', suspensionReason: marker, deletedAt: IsNull() },
      { memberStatus: 'ACTIVE', suspensionReason: null, suspendedUntil: null },
    );
    if (!res.affected) return null;
    await repo.increment({ tenantMemberId, tenantId }, 'sessionVersion', 1);
    return repo.findOne({ where: { tenantMemberId, tenantId } });
  });
  if (!row) return false;
  await redis.del(`tenant:member:${row.userId}:${tenantId}`).catch(() => {});
  auditMember(tenantId, undefined, 'tenant_member.review_released', tenantMemberId, { userId: row.userId, source: 'firewall' });
  await notifyMemberChange(
    tenantId,
    row.userId,
    'Your membership is active',
    '<p>Your membership of this workspace is active again.</p>',
  );
  return true;
}

/** Record member activity (cheap, fire-and-forget friendly). */
export async function touchLastActive(tenantId: string, userId: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) =>
    repo.update({ tenantId, userId, deletedAt: IsNull() }, { lastActiveAt: new Date() }))
    .catch(() => {});
}

/**
 * Transfer ownership: promote `toUserId` to OWNER and demote the current
 * OWNER(s) to ADMIN, atomically. Guards against leaving the tenant ownerless.
 */
export async function transferOwnership(tenantId: string, toUserId: string, demoteToRole: TenantMemberRole = 'ADMIN', actorId?: string): Promise<void> {
  const targetMemberId = await withTenantTransactionFor(tenantId, async (qr) => {
    await lockOwners(qr, tenantId);
    const repo = qr.manager.getRepository(TenantMemberEntity);
    const target = await repo.findOne({ where: { tenantId, userId: toUserId, deletedAt: IsNull() } });
    if (!target) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    // tenant_member.04 (fixed 2026-10-20): ownership goes only to an ACTIVE member. A SUSPENDED, deprovisioned (INACTIVE) or
    // never-accepted (PENDING) member used to be silently reactivated as OWNER by the transfer.
    if (target.memberStatus !== 'ACTIVE') {
      throw new AppError('Ownership can only be transferred to an active member', 409, ErrorCode.CONFLICT);
    }
    const demoted = await repo.find({ where: { tenantId, memberRole: 'OWNER', deletedAt: IsNull() } });
    await repo.update({ tenantId, memberRole: 'OWNER', deletedAt: IsNull() }, { memberRole: demoteToRole });
    await repo.update({ tenantMemberId: target.tenantMemberId, tenantId }, { memberRole: 'OWNER' });
    await repo.increment({ tenantId }, 'sessionVersion', 1);
    return { id: target.tenantMemberId, demotedUserIds: demoted.map((d) => d.userId) };
  });
  auditMember(tenantId, actorId, 'tenant_member.ownership_transferred', targetMemberId.id, { toUserId, demotedTo: demoteToRole });
  // tenant_member.04: every owner who stepped down is re-read on the next request, not served OWNER from the member cache.
  for (const userId of new Set([toUserId, ...targetMemberId.demotedUserIds])) {
    await redis.del(`tenant:member:${userId}:${tenantId}`).catch(() => {});
  }
  await WebhookService.dispatchEvent(tenantId, 'member.updated', {
    userId: toUserId, memberRole: 'OWNER', ownershipTransfer: true,
  }).catch(() => {});
}

export async function remove(tenantMemberId: string, tenantId: string, actorId?: string): Promise<void> {
  const { row: member, ends } = await withTenantTransactionFor(tenantId, async (qr) => {
    await lockOwners(qr, tenantId);
    const repo = qr.manager.getRepository(TenantMemberEntity);
    const row = await repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (row.memberRole === 'OWNER' && row.memberStatus === 'ACTIVE' && (await otherActiveOwners(qr, tenantId, tenantMemberId)) === 0) {
      throw new AppError(TenantMemberMessages.LAST_OWNER, 409, ErrorCode.CONFLICT);
    }
    // Conditional: two concurrent removals announce `member.deleted` once.
    const res = await repo.update({ tenantMemberId, tenantId, deletedAt: IsNull() }, { deletedAt: new Date() });
    if (!res.affected) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    // D249: the member's session-ending orders (the websocket drops) in this transaction
    const ends = await recordSessionEndInTx(qr, { type: 'member_access_ended', tenantId, userId: row.userId, reason: 'membership_ended' });
    return { row, ends };
  });
  await ends.afterCommit();
  await WebhookService.dispatchEvent(tenantId, 'member.deleted', {
    tenantMemberId,
    userId: member.userId,
  });
  await notifyMembershipEnded({ tenantId, userId: member.userId, reason: 'removed', ...orderedBy(ends, tenantId) });
  auditMember(tenantId, actorId, 'tenant_member.deleted', tenantMemberId, {
    userId: member.userId,
    memberRole: member.memberRole,
  });
}

/**
 * Whether the person who FILED a parked membership change may make it (tenant_member.05, fixed 2026-10-20). The approval only
 * proves that a second person agreed; it is not proof that the submitter was allowed to ask. The replay re-applies the route's rank
 * rules to the submitter as they stand NOW:
 *  - the submitter must be an ACTIVE, non-deleted OWNER or ADMIN of the tenant (no submitter: refused);
 *  - `role_change`: the target role is strictly below the submitter's (PUT /members/[id]);
 *  - `add`: an OWNER adds any role, anyone else strictly below their own (POST /members);
 *  - `remove`: an OWNER removes anyone (the last-owner rule still applies), anyone else only a member strictly below them.
 */
export async function submitterMayReplay(
  tenantId: string,
  submitterUserId: string | null | undefined,
  change: { action: 'role_change' | 'remove' | 'add'; targetRole?: string; tenantMemberId?: string },
): Promise<boolean> {
  if (!submitterUserId) return false;
  return withTenantRepositoryFor(tenantId, TenantMemberEntity, async (repo) => {
    const submitter = await repo.findOne({ where: { tenantId, userId: submitterUserId, memberStatus: 'ACTIVE', deletedAt: IsNull() } });
    const own = ROLE_RANK[String(submitter?.memberRole ?? '')] ?? 0;
    if (own < ROLE_RANK.ADMIN!) return false;
    if (change.action === 'role_change') return rankOf(change.targetRole) < own;
    if (change.action === 'add') return submitter!.memberRole === 'OWNER' || rankOf(change.targetRole) < own;
    if (submitter!.memberRole === 'OWNER') return true;
    const target = change.tenantMemberId
      ? await repo.findOne({ where: { tenantMemberId: change.tenantMemberId, tenantId, deletedAt: IsNull() } })
      : null;
    return !!target && rankOf(target.memberRole) < own;
  });
}
