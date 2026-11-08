import 'reflect-metadata';
import { runPurgeSteps, recordLifecycle } from './tenant.extension-points';
import { sessionEndOrderedBy as orderedBy } from './tenant.session-end';
import { recordSessionEndInTx } from '@kuraykaraaslan-labs/session_end/server/session_end.in-tx';
import { deliverTenantCacheDrop, recordTenantCacheDrop } from './tenant.cache-drop';
import { purgeTenantFiles, sweepRetainedFiles, type RetainedFilesSweepResult } from './tenant.purge-files';
import { shredTenantKeys, type TenantKeyShredOutcome } from './tenant.purge-keys';
import { In, IsNull, LessThan, Not, type FindOptionsWhere } from 'typeorm';
import { withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor, clearTenantDsCache } from '@kuraykaraaslan-labs/db';
import { assertDeletionAllowed } from './tenant.deletion-guard';
import { assertNoFleetDeletionBlock, fleetDeletionBlock } from './tenant.deletion-rules';
import { Tenant, type DeletionRequester } from './entities/tenant.entity';
import { TenantSlugTombstone } from './entities/tenant_slug_tombstone.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import TenantMessages from './tenant.messages';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { clearTenantCache } from '@kuraykaraaslan-labs/redis';

export const DELETION_GRACE_DAYS = 30;

/** 04-tenant-setting 1.7: the refusal of a second request while a deletion is already scheduled (its date is in `details.deleteAfter`). */
export const DELETION_ALREADY_PENDING = 'A deletion is already scheduled for this tenant';

/** What the danger zone reads at mount (04-tenant-setting 1.7): the tenant's status and, while one is scheduled, its dates and who asked for it. */
export type TenantDeletionStatus = {
  tenantStatus: string; deleteAfter: Date | null; deletionRequestedAt: Date | null; deletionRequestedBy: DeletionRequester | null;
};

/** 04-tenant-setting 1.7: the refusal of an owner's cancel of a deletion the platform operator or the fleet asked for (`details.reason`). */
export const DELETION_REQUESTED_BY_OPERATOR = 'This deletion was scheduled by the platform operator; only the operator can cancel it';

/**
 * 1.7: the requesters whose deletion the tenant's own OWNER may cancel: an owner's request and the last member's account self-service deletion.
 * Not OPERATOR or FLEET, and not NULL either: a deletion requested before tenant migration 134 has no requester and counts as the operator's
 * (fail closed).
 */
export const OWNER_CANCELLABLE_REQUESTERS: readonly DeletionRequester[] = ['OWNER', 'SELF_SERVICE'];

/**
 * The tenants whose data keys the key-shredding sweep retries, 100 per run: a key not DESTROYED yet, or DESTROYED with a provider slot a destroy could
 * not reach (`slotsPendingAt`, db 003), of a tenant this node actually PURGED (`purgedAt`, tenant 133; never a mere `deletedAt`, which the admin soft
 * delete sets too):
 *  - the deletion purge (the row soft-deleted by the purge's claim): reason TENANT_PURGE;
 *  - a migration's source purge (the RELOCATED tombstone, purged after its current relocation): reason MIGRATED_AWAY, so a later homecoming still
 *    gets a new generation.
 */
export const PURGED_TENANTS_WITH_LIVE_KEYS_SQL = `SELECT DISTINCT k."tenantId"::text AS "tenantId",
    CASE WHEN t."deletedAt" IS NOT NULL THEN 'TENANT_PURGE' ELSE 'MIGRATED_AWAY' END AS "reason"
  FROM "tenant_keys" k JOIN "tenants" t ON t."tenantId" = k."tenantId"
  WHERE (k."state" <> 'DESTROYED' OR k."slotsPendingAt" IS NOT NULL) AND t."purgedAt" IS NOT NULL
    AND (t."deletedAt" IS NOT NULL OR (t."tenantStatus" = 'RELOCATED' AND t."relocatedAt" <= t."purgedAt"))
  ORDER BY 1 LIMIT 100`;

const refusalMessage = (refusal: unknown): string => (refusal instanceof Error ? refusal.message : String(refusal));

export default class TenantDeletionService {

  /**
   * `refuseIfPending` (04-tenant-setting 1.7, the deletion-request route): a tenant already PENDING_DELETION is refused 409 with its
   * `deleteAfter` instead of having its grace period restarted, and the write is conditional on that, so a concurrent request loses
   * too. Without it the call behaves as before (the fleet's executor answers NOOP for a pending tenant before it gets here; the privacy
   * self-deletion passes it, so it never takes over another requester's deletion).
   * `requestedBy` (1.7): who asks, stored with the request (a re-request without `refuseIfPending` takes it over); it decides whether the
   * tenant's OWNER may cancel it later.
   */
  static async requestDeletion(
    tenantId: string, graceDays: number | undefined, opts: { requestedBy: DeletionRequester; refuseIfPending?: boolean },
  ): Promise<{ deleteAfter: Date }> {
    const tenant = await withTenantRepositoryFor(tenantId, Tenant, (repo) =>
      repo.findOne({ where: { tenantId, deletedAt: IsNull() } }));
    if (!tenant) throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
    if (opts.refuseIfPending && tenant.tenantStatus === 'PENDING_DELETION') throw this.alreadyPending(tenant);
    // Refuse at REQUEST time, not at purge time: the purge runs unattended from a
    // cron, where a 409 would just be a log line and the clients would be stranded.
    assertNoFleetDeletionBlock(tenant);
    await assertDeletionAllowed(tenantId);

    const days = graceDays ?? DELETION_GRACE_DAYS;
    const now = new Date();
    const deleteAfter = new Date(now);
    deleteAfter.setDate(deleteAfter.getDate() + days);

    const { res, ends, drops } = await withTenantTransactionFor(tenantId, async (qr) => {
      const res = await qr.manager.getRepository(Tenant).update(
        { tenantId, deletedAt: IsNull(), ...(opts.refuseIfPending ? { tenantStatus: Not('PENDING_DELETION') } : {}) },
        { tenantStatus: 'PENDING_DELETION', deletionRequestedAt: now, deleteAfter, deletionRequestedBy: opts.requestedBy },
      );
      // D249: the tenant's session-ending orders (every live socket) in this transaction, when the request took
      const ends = res && res.affected === 0 ? null
        : await recordSessionEndInTx(qr, { type: 'tenant_access_ended', tenantId, reason: 'deletion_requested' });
      // D270: the cached profile says PENDING_DELETION at once (an API key of the tenant is refused), also through a Redis outage
      const drops = res && res.affected === 0 ? [] : await recordTenantCacheDrop(qr, tenantId);
      return { res, ends, drops };
    });
    // 1.7: another request won the race between the read and the write; its date stands
    if (opts.refuseIfPending && res && res.affected === 0) throw this.alreadyPending(await this.deletionStatus(tenantId));
    await deliverTenantCacheDrop(drops);
    await ends?.afterCommit();
    Logger.info(`[TenantDeletion] Deletion requested for tenant ${tenantId}, scheduled for ${deleteAfter.toISOString()}`);
    await recordLifecycle({ tenantId, type: 'DELETION_REQUESTED', occurredAt: now, ...orderedBy(ends, tenantId) });
    await this.notifyOwnersDeletionRequested(tenantId, deleteAfter);
    return { deleteAfter };
  }

  /** The 409 of a second request, with the pending deletion's date and (1.7) who asked for it, so the danger zone can tell whether to offer Cancel. */
  private static alreadyPending(pending: { deleteAfter?: Date | null; deletionRequestedBy?: DeletionRequester | null } | null): AppError {
    const deleteAfter = pending?.deleteAfter ?? null;
    return new AppError(DELETION_ALREADY_PENDING, 409, ErrorCode.CONFLICT, {
      details: {
        reason: 'DELETION_PENDING', deleteAfter: deleteAfter ? new Date(deleteAfter).toISOString() : null, requestedBy: pending?.deletionRequestedBy ?? null,
      },
    });
  }

  /**
   * 04-tenant-setting 1.7: the deletion state of one tenant, read through that tenant's own scope (the settings page's danger zone
   * starts from it). Null for an unknown or purged tenant.
   */
  static async deletionStatus(tenantId: string): Promise<TenantDeletionStatus | null> {
    const tenant = await withTenantRepositoryFor(tenantId, Tenant, (repo) =>
      repo.findOne({ where: { tenantId, deletedAt: IsNull() } }));
    if (!tenant) return null;
    return {
      tenantStatus: tenant.tenantStatus, deleteAfter: tenant.deleteAfter ?? null, deletionRequestedAt: tenant.deletionRequestedAt ?? null,
      deletionRequestedBy: tenant.deletionRequestedBy ?? null,
    };
  }

  /**
   * tenant.01 (fixed 2026-10-20): the OWNERs hear about a scheduled deletion when it is REQUESTED, while the grace period still lets
   * them stop it, not only once the purge has started. CRITICAL, so a muted-email preference cannot silence it. Best-effort: a
   * notification failure is logged and does not undo the request.
   */
  private static async notifyOwnersDeletionRequested(tenantId: string, deleteAfter: Date): Promise<void> {
    try {
      const { default: TenantMemberService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.service');
      const { members } = await TenantMemberService.getByTenantId({
        tenantId, page: 1, pageSize: 50, search: null, memberRole: 'OWNER', memberStatus: null,
      });
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      const when = deleteAfter.toISOString().slice(0, 10);
      for (const owner of members) {
        await NotificationService.notifyCritical(
          tenantId,
          { userId: owner.userId, email: owner.user?.email },
          {
            event: 'tenant.deletion_requested',
            category: 'security',
            title: 'Your workspace is scheduled for deletion',
            body: `Your workspace will be permanently deleted after ${when}. Contact support or cancel the deletion before then if this was not intended.`,
            data: {
              html: `<p>Your workspace has been <strong>scheduled for permanent deletion</strong> after ${when}.</p>`
                + '<p>If this was not intended, cancel the deletion or contact support before that date.</p>',
            },
          },
          { idempotencyKey: `tenant-deletion-requested:${tenantId}:${deleteAfter.getTime()}:${owner.userId}` },
        ).catch((err: unknown) => Logger.warn(`[TenantDeletion] deletion notice to ${owner.userId} failed: ${err instanceof Error ? err.message : String(err)}`));
      }
      if (!members.length) Logger.warn(`[TenantDeletion] No OWNER to notify of the deletion request for tenant ${tenantId}`);
    } catch (err) {
      Logger.warn(`[TenantDeletion] Deletion-request notice failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * `onlyRequestedBy` (04-tenant-setting 1.7, the OWNER's cancel): restore only a deletion one of these requesters asked for, in the same
   * conditional write (a NULL requester never matches). A deletion still pending from someone else is a 403 with
   * `details.reason` 'REQUESTED_BY_OPERATOR'; one no longer pending stays the 409.
   */
  static async cancelDeletion(tenantId: string, opts: { onlyRequestedBy?: readonly DeletionRequester[] } = {}): Promise<void> {
    // Only a tenant that is actually PENDING_DELETION (and not yet purged) is
    // restored. This used to set ACTIVE unconditionally — "cancel deletion" on
    // a SUSPENDED tenant lifted the suspension, and on a purged one revived it.
    const { res, drops } = await withTenantRepositoryFor(tenantId, Tenant, async (repo) => {
      const res = await repo.update(
        { tenantId, tenantStatus: 'PENDING_DELETION', deletedAt: IsNull(), ...(opts.onlyRequestedBy ? { deletionRequestedBy: In([...opts.onlyRequestedBy]) } : {}) },
        { tenantStatus: 'ACTIVE', deletionRequestedAt: null, deleteAfter: null, deletionRequestedBy: null } as never,
      );
      return { res, drops: res.affected ? await recordTenantCacheDrop(repo.manager?.queryRunner, tenantId) : [] };
    });
    if (!res.affected) {
      const pending = opts.onlyRequestedBy ? await this.deletionStatus(tenantId) : null;
      if (pending?.tenantStatus === 'PENDING_DELETION') {
        throw new AppError(DELETION_REQUESTED_BY_OPERATOR, 403, ErrorCode.FORBIDDEN, {
          details: { reason: 'REQUESTED_BY_OPERATOR', requestedBy: pending.deletionRequestedBy },
        });
      }
      throw new AppError(TenantMessages.TENANT_NOT_PENDING_DELETION, 409, ErrorCode.CONFLICT);
    }
    await deliverTenantCacheDrop(drops);
    Logger.info(`[TenantDeletion] Deletion cancelled for tenant ${tenantId}`);
    await recordLifecycle({ tenantId, type: 'RESTORED', occurredAt: new Date() });
  }

  /**
   * Hard-purge expired tenants with full cross-module cascade. A tenant is skipped, left PENDING_DELETION for the next sweep, while a
   * legal hold on its row runs or while a `tenant:deletion_guard` objects (or cannot answer) — see {@link purgeRefusal}. Then:
   * 1. Cancel active subscriptions with payment provider
   * 2. Revoke API keys
   * 3. Delete S3/storage objects, except those a module must still retain (`tenant:purge_retention`; see {@link sweepRetainedFiles})
   * 4. Flush Redis tenant cache
   * 5. Clear per-tenant DataSource cache
   * 6. Soft-remove the tenant row
   */
  static async purgeExpiredTenants(): Promise<number> {
    const now = new Date();
    const due: FindOptionsWhere<Tenant> = { tenantStatus: 'PENDING_DELETION', deleteAfter: LessThan(now), deletedAt: IsNull() };

    // Tenants due for purge: a sweep across tenants (listActiveTenants() only
    // returns ACTIVE ones, and these are PENDING_DELETION by definition).
    const toDelete = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find({ where: due }));

    let purged = 0;
    for (const tenant of toDelete) {
      // Defence in depth: reserved platform tenants (root, fleet) are never purged, whatever their row says.
      if (isReservedTenant(tenant.tenantId)) {
        Logger.error(`[TenantDeletion] Refusing to purge reserved tenant ${tenant.tenantId}`);
        continue;
      }
      // A legal hold placed during the grace period stops the purge until it runs out: the tenant stays PENDING_DELETION
      // and the next sweep after the hold ends purges it.
      if (fleetDeletionBlock(tenant, now) === 'LEGAL_HOLD') {
        Logger.warn(`[TenantDeletion] Purge of tenant ${tenant.tenantId} deferred: legal hold until ${tenant.legalHoldUntil!.toISOString()}`);
        continue;
      }
      // The same for an objection a contributed guard raised during the grace period. Nothing is claimed yet, so the next sweep asks again.
      const refused = await this.purgeRefusal(tenant.tenantId);
      if (refused) {
        Logger.warn(`[TenantDeletion] Purge of tenant ${tenant.tenantId} deferred: ${refusalMessage(refused.refusal)}`);
        continue;
      }
      try {
        // Claim first — the soft delete is conditional on the tenant still
        // being due. A deletion cancelled after the read above used to be
        // purged anyway (the cascade ran, then a whole-row softRemove).
        if (!(await this.purgeClaimed(tenant, due, now))) continue;
        purged++;
        // D10: a second flush once the whole purge is done. The steps after the cascade's own flush (the key shred, its audit,
        // the receipt) may read the tenant again and re-cache it; nothing of the purged tenant may be left in Redis.
        await clearTenantCache(tenant.tenantId).catch((err: unknown) =>
          Logger.warn(`[TenantDeletion] final cache flush for ${tenant.tenantId} failed: ${err instanceof Error ? err.message : String(err)}`));
        Logger.info(`[TenantDeletion] Purged tenant ${tenant.tenantId}`);
      } catch (err) {
        Logger.error(`[TenantDeletion] Failed to purge tenant ${tenant.tenantId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return purged;
  }

  /**
   * Deletes the retained files of purged tenants whose retention has ended (asking the `tenant:purge_retention` contributors again
   * first, so a hold that still stands keeps its file). Run by the purge job and its cron route after {@link purgeExpiredTenants};
   * never throws.
   */
  static sweepRetainedFiles(now?: Date): Promise<RetainedFilesSweepResult> {
    return sweepRetainedFiles(now);
  }

  /**
   * Warn the tenant OWNER by email that their tenant is about to be permanently
   * purged. Best-effort: resolves the OWNER via `tenant_member` and enqueues one
   * mail on the shared `notification_mail` queue; any failure (no owner, no
   * email, mail infra down) is logged and never thrown, so it can never block
   * the purge. Dynamic imports keep the mail / membership infra off the hot
   * path — mirroring how {@link cascadePurge} pulls in its siblings — and avoid
   * a static dependency cycle (both siblings transitively require `tenant`).
   */
  private static async notifyOwnerBeforePurge(tenantId: string): Promise<void> {
    try {
      const { default: TenantMemberService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.service');
      const { members } = await TenantMemberService.getByTenantId({
        tenantId,
        page: 1,
        pageSize: 1,
        search: null,
        memberRole: 'OWNER',
        memberStatus: null,
      });
      const email = members[0]?.user?.email;
      if (!email) {
        Logger.warn(`[TenantDeletion] No OWNER email to warn before purging tenant ${tenantId}`);
        return;
      }

      // Through the dispatcher (PLAT-01) and CRITICAL — the strongest case in
      // the whole sweep. The owner's workspace is about to be destroyed
      // irreversibly, and a muted-email preference must not be the reason they
      // missed the last chance to stop it.
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      await NotificationService.notifyCritical(
        tenantId,
        { userId: members[0]?.userId, email },
        {
          event: 'tenant.purge_warning',
          category: 'security',
          title: 'Your workspace is being permanently deleted',
          body: 'The grace period for your scheduled workspace deletion has elapsed.',
          data: {
            html: '<p>The grace period for your scheduled workspace deletion has elapsed, so your '
              + 'workspace is now being <strong>permanently deleted</strong>. All data, API keys and '
              + 'uploaded files will be removed and cannot be recovered.</p>'
              + '<p>Files the law requires us to keep, such as issued invoices, are kept until their '
              + 'retention period ends and then deleted.</p>'
              + '<p>If this was not intended, contact support immediately.</p>',
          },
        },
        { idempotencyKey: `tenant-purge-warning:${tenantId}` },
      );
      Logger.info(`[TenantDeletion] Purge warning emailed to OWNER of tenant ${tenantId}`);
    } catch (err) {
      Logger.warn(`[TenantDeletion] Purge warning email failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Purges one tenant NOW, whatever is left of its grace period: the class-3 `tenant.purge` of the fleet directory (docs/phases/02-fleet/05 section 7
   * stage 9, an operator decision with its own approval). Only a tenant awaiting deletion is purged; a legal hold or the tenant's other objections
   * refuse it, a platform tenant is never purged, and a tenant already purged is reported as such so a re-delivered command changes nothing.
   * The contributed guards answer the way they do on the request path: an objection (409) is BLOCKED, and a guard that cannot answer (503)
   * throws, so the command fails and may be retried instead of being refused for good.
   */
  static async purgeNow(tenantId: string): Promise<'PURGED' | 'ALREADY_PURGED' | 'NOT_FOUND' | 'NOT_PENDING' | 'BLOCKED'> {
    if (isReservedTenant(tenantId)) return 'BLOCKED';
    const now = new Date();
    const tenant = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).findOne({ where: { tenantId }, withDeleted: true }));
    if (!tenant) return 'NOT_FOUND';
    if (tenant.deletedAt) return 'ALREADY_PURGED';
    if (tenant.tenantStatus !== 'PENDING_DELETION') return 'NOT_PENDING';
    if (fleetDeletionBlock(tenant, now)) return 'BLOCKED';
    const refused = await this.purgeRefusal(tenantId);
    if (refused) {
      Logger.warn(`[TenantDeletion] Purge of tenant ${tenantId} refused: ${refusalMessage(refused.refusal)}`);
      if ((refused.refusal as { statusCode?: number } | null)?.statusCode === 409) return 'BLOCKED';
      throw refused.refusal;
    }
    return (await this.purgeClaimed(tenant, { tenantStatus: 'PENDING_DELETION', deletedAt: IsNull() }, now)) ? 'PURGED' : 'NOT_PENDING';
  }

  /**
   * The `tenant:deletion_guard` contributors, asked again right before a purge; null when none objects, else what the check threw (wrapped,
   * so even a guard that throws a falsy value refuses).
   *
   * They answered when the deletion was requested, but the grace period is long: a legal hold placed on a document, or a refund started,
   * after the request is an objection the request never saw, and without this the purge destroyed the files anyway. A guard that cannot
   * answer refuses too (fail closed, 503), exactly as on the request path. Asked BEFORE the claim, so a refused tenant is left as it was
   * (PENDING_DELETION, `deletedAt` unset) and the next run asks again; nothing has to be released.
   */
  private static async purgeRefusal(tenantId: string): Promise<{ refusal: unknown } | null> {
    try {
      await assertDeletionAllowed(tenantId);
      return null;
    } catch (refusal) {
      return { refusal };
    }
  }

  /**
   * The purge of one tenant row: claim it first (the soft delete is conditional on `where`, so a deletion cancelled meanwhile is not purged), then
   * tombstone its slug, run the cascade and report PURGED to the lifecycle sinks. False when the claim lost.
   */
  private static async purgeClaimed(tenant: Tenant, where: FindOptionsWhere<Tenant>, now: Date): Promise<boolean> {
    // `purgedAt` in the same claim: the purge's own mark, which the key-shredding sweep trusts (tenant 133)
    const { res, ends } = await withTenantTransactionFor(tenant.tenantId, async (qr) => {
      const res = await qr.manager.getRepository(Tenant).update({ tenantId: tenant.tenantId, ...where }, { deletedAt: now, purgedAt: now });
      // D249: the purged tenant's session-ending orders in the claim's transaction (a released claim drops sockets of a tenant
      // already awaiting deletion: nothing is left open)
      const ends = res.affected ? await recordSessionEndInTx(qr, { type: 'tenant_access_ended', tenantId: tenant.tenantId, reason: 'purged' }) : null;
      return { res, ends };
    });
    if (!res.affected) return false;
    await ends?.afterCommit();
    if (tenant.slug) await this.tombstoneSlug(tenant.slug, tenant.tenantId, now);
    let shred: TenantKeyShredOutcome;
    try {
      shred = await this.cascadePurge(tenant.tenantId, now);
    } catch (err) {
      // tenant_subscription.02 (fixed 2026-10-20): the API-key revocation could not run. The claim is released (the tenant goes
      // back to PENDING_DELETION, not soft-deleted) so the next run retries, instead of leaving live keys for a deleted tenant with
      // nothing left to retry. Nothing destructive has run yet (the revocation precedes the file, cache and key steps).
      await withTenantRepositoryFor(tenant.tenantId, Tenant, (repo) =>
        repo.update({ tenantId: tenant.tenantId }, { deletedAt: null, purgedAt: null } as never));
      throw err;
    }
    // The receipt says what crypto-shredding reached (counts and the hash of the key-protected families, class G).
    await recordLifecycle({ tenantId: tenant.tenantId, type: 'PURGED', occurredAt: now, payload: { counts: shred.counts, hashes: shred.hashes }, ...orderedBy(ends, tenant.tenantId) });
    return true;
  }

  /**
   * Retries crypto-shredding for the tenants this node purged whose data keys still stand (the destroy failed during the purge: a database or
   * key-store outage) or whose provider slots a destroy could not reach (`TDEK_PENDING_SLOTS`: the rows are DESTROYED but the slot outside the
   * database, which a pre-purge backup still opens the key with, is there): see {@link PURGED_TENANTS_WITH_LIVE_KEYS_SQL}. Covers both the deletion
   * purge and a migration's source purge (whose executor records `TDEK_NOT_DESTROYED` and leaves the retry here). Run by the purge job and its cron
   * route after {@link purgeExpiredTenants}; never throws. Returns how many tenants were retried and how many of them are now fully shredded.
   */
  static async sweepPurgedTenantKeys(): Promise<{ retried: number; shredded: number }> {
    let due: Array<{ tenantId: string; reason: 'TENANT_PURGE' | 'MIGRATED_AWAY' }> = [];
    try {
      due = await withSystemRLS(async (qr) => await qr.query(PURGED_TENANTS_WITH_LIVE_KEYS_SQL) as typeof due);
    } catch (err) {
      Logger.warn(`[TenantDeletion] key shredding sweep could not list purged tenants: ${err instanceof Error ? err.message : String(err)}`);
      return { retried: 0, shredded: 0 };
    }
    let shredded = 0;
    for (const { tenantId, reason } of due) {
      if (isReservedTenant(tenantId)) continue;
      const out = await shredTenantKeys(tenantId, reason === 'MIGRATED_AWAY' ? 'MIGRATED_AWAY' : 'TENANT_PURGE');
      if (!out.error && !out.counts.TDEK_PENDING_SLOTS) shredded++;
    }
    return { retried: due.length, shredded };
  }

  /**
   * Block the purged tenant's slug for good (docs/phases/02-fleet/05 section 5.2). Today the soft-deleted row still holds the slug in the unique
   * index, so a failure here is logged and not fatal; the tombstone is what keeps the slug blocked once the row itself is gone. Idempotent.
   */
  private static async tombstoneSlug(slug: string, tenantId: string, purgedAt: Date): Promise<void> {
    try {
      await withSystemRLS((qr) => qr.manager.createQueryBuilder().insert().into(TenantSlugTombstone)
        .values({ slug, tenantId, purgedAt }).orIgnore().execute());
    } catch (err) {
      Logger.error(`[TenantDeletion] Slug tombstone for tenant ${tenantId} not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Cross-module purge cascade — best-effort, logs failures without aborting.
   */
  private static async cascadePurge(tenantId: string, now: Date): Promise<TenantKeyShredOutcome> {
    const errors: string[] = [];

    // 0. Warn the tenant OWNER before anything is destroyed (best-effort).
    await this.notifyOwnerBeforePurge(tenantId);

    // 1. Teardown steps other modules contribute (`tenant:purge_step`), e.g. cancelling the subscription with the payment provider
    errors.push(...await runPurgeSteps(tenantId));

    // 2. Revoke all API keys for this tenant. A failure THROWS (tenant_subscription.02): purgeClaimed releases the claim so the
    // tenant stays retryable; it used to be swallowed, leaving live keys behind a soft-deleted tenant.
    const { default: ApiKeyService } = await import('@kuraykaraaslan-labs/api_key/server/api_key.service');
    await ApiKeyService.revokeAll(tenantId);

    // 3. Storage objects (S3 / R2): every file of the tenant is deleted unless a module must still retain it (an issued invoice, a
    // document under retention or legal hold). Retained files are marked on their rows and deleted by the sweep once retention ends;
    // when a retention check cannot answer, no file is deleted now and the sweep asks again (tenant.purge-files.ts).
    try {
      await purgeTenantFiles(tenantId, now);
    } catch (err) {
      errors.push(`storage: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Flush every Redis key that names this tenant: the erasure path at the cache layer, so a flush that could not run is reported
    try {
      await clearTenantCache(tenantId);
    } catch (err) {
      errors.push(`redis: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 5. Clear per-tenant DataSource cache
    clearTenantDsCache(tenantId);

    // 6. Crypto-shredding, last: every step above may still need the tenant's secrets (P7-TDEK, tenant.purge-keys.ts). Never throws.
    const shred = await shredTenantKeys(tenantId);
    if (shred.error) errors.push(`tenant keys: ${shred.error}`);

    if (errors.length > 0) {
      Logger.warn(`[TenantDeletion] Cascade purge for ${tenantId} had errors: ${errors.join(', ')}`);
    }
    return shred;
  }
}
