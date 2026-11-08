import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import redis from '@kuraykaraaslan-labs/redis';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service';
import NotificationLogService from '@kuraykaraaslan-labs/notification_log/server/notification_log.service';
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { isPlatformServed } from '@kuraykaraaslan-labs/common/server/external-extensions';
import type { SMSResult } from './providers/base.provider';
import NotificationSmsProviderService, { type SMSProviderType } from './notification_sms.provider.service';
import { RedisIdempotencyService } from '@kuraykaraaslan-labs/redis_idempotency';
import { isOptedOut, keywordAction, recordOptOutState, SmsOptOutUnknownError } from './notification_sms.optout';

const SMS_WORKER_SLOT = Symbol.for('nb.worker.smsQueue');
const smsWorkerStore = globalThis as typeof globalThis & { [SMS_WORKER_SLOT]?: Worker<SMSJobData> };

interface SMSJobData {
  tenantId: string;
  to: string;
  body: string;
  provider?: SMSProviderType;
  idempotencyKey?: string;
}

export default class NotificationSmsQueueService {

  static readonly QUEUE_NAME = 'smsQueue';
  static readonly RATE_LIMIT_SECONDS = env.SMS_RATE_LIMIT_SECONDS ?? 60;
  static readonly RATE_LIMIT_PREFIX = 'sms:rate-limit:';

  /**
   * Finished SMS jobs (phone number and message body) are kept for a day, or a
   * week when failed, capped by count as well; without this they stayed in Redis
   * forever. A count cap is safe here: re-sends are guarded by
   * RedisIdempotencyService in the worker, not by the retained job.
   */
  static readonly JOB_RETENTION = {
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
  } as const;

  static readonly QUEUE = new Queue<SMSJobData>(NotificationSmsQueueService.QUEUE_NAME, {
    connection: getBullMQConnection(),
    defaultJobOptions: NotificationSmsQueueService.JOB_RETENTION,
  });

  /**
   * Starts the SMS consumer. Called from the `common:boot_task` consumer phase,
   * never at import, so a process that only enqueues does not consume; the
   * worker registers a drain so SIGTERM waits for the send in flight. The
   * globalThis slot keeps it to one per process across bundle layers. Idempotent.
   */
  static startWorker(): Worker<SMSJobData> {
    const existing = smsWorkerStore[SMS_WORKER_SLOT];
    if (existing) return existing;
    const worker = new Worker<SMSJobData>(
      NotificationSmsQueueService.QUEUE_NAME,
      async (job: Job<SMSJobData>) => {
        const { tenantId, to, body, provider, idempotencyKey } = job.data;
        Logger.info(`SMS Worker ${job.id} processing...`);
        // Guard worker retries from re-sending an already-delivered SMS.
        await RedisIdempotencyService.run(tenantId, idempotencyKey, () =>
          NotificationSmsQueueService._sendShortMessage({ tenantId, to, body, provider }),
        );
      },
      { connection: getBullMQConnection() },
    );
    worker.on('completed', (job: Job<SMSJobData>) => {
      Logger.info(`SMS Worker ${job.id} completed`);
    });
    worker.on('failed', (job: Job<SMSJobData> | undefined, err: Error) => {
      Logger.error(`SMS Worker ${job?.id ?? 'unknown'} failed: ${err.message}`);
    });
    smsWorkerStore[SMS_WORKER_SLOT] = worker;
    registerWorkerDrain(worker);
    return worker;
  }

  static async assertSmsFeatureAccess(tenantId: string): Promise<void> {
    if (isRootTenant(tenantId)) return;
    await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_SMS_SEND);
    // Phase 53.5: the plan's monthly quota counts what the platform's provider sends; a tenant's own provider is not the plan's.
    if (!(await isPlatformServed(tenantId, 'sms:provider'))) return;
    const usage = await TenantUsageService.getUsage(tenantId);
    await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_SMS_MONTHLY_QUOTA, usage.smsSends);
  }

  /**
   * Read-only headroom of the monthly SMS quota, with the same gate and usage read as `assertSmsFeatureAccess`; counts
   * nothing and writes no audit row (the channel's `quota`, G-137). `reason` tells a spent quota from a plan without access.
   */
  static async monthlyQuota(tenantId: string): Promise<{ allowed: boolean; key: string; reason?: 'spent' | 'no_access' }> {
    const key = FEATURE_KEYS.FEATURE_SMS_MONTHLY_QUOTA;
    if (isRootTenant(tenantId)) return { allowed: true, key };
    if (!(await isPlatformServed(tenantId, 'sms:provider'))) return { allowed: true, key }; // the tenant's own provider (phase 53.5)
    const usage = await TenantUsageService.getUsage(tenantId);
    const r = await FeatureGateService.checkFeatureAccess(tenantId, key, usage.smsSends, { audit: false });
    if (r.allowed) return { allowed: true, key };
    // a BOOLEAN answer for a LIMIT key means no live plan named it (undeclared, or no live plan): not a spent quota
    return { allowed: false, key, reason: r.type === 'BOOLEAN' || r.limit === 0 ? 'no_access' : 'spent' };
  }

  // ── Per-tenant enable toggle + opt-out (STOP keyword) suppression ─────────

  /** Whether SMS is enabled for the tenant (`smsEnabled` setting, default on). */
  static async isSmsEnabled(tenantId: string): Promise<boolean> {
    const raw = await SettingService.getValue(tenantId, 'smsEnabled').catch(() => null);
    return raw !== 'false';
  }

  /**
   * Whether `to` opted out (STOP) of this tenant's messages: the durable list (`notification_sms_optouts`, D254) behind a Redis cache
   * (notification_sms.optout.ts). A cache miss or a Redis error reads the table; throws `SmsOptOutUnknownError` when the table cannot answer
   * either, never "not opted out" because nothing could answer.
   */
  static async isOptedOut(tenantId: string, to: string): Promise<boolean> {
    return isOptedOut(tenantId, to);
  }

  /** Records a STOP for `to` (the table, then the cache). Throws when the table cannot be written. */
  static async recordOptOut(tenantId: string, to: string, keyword = 'STOP'): Promise<void> {
    await recordOptOutState(tenantId, to, true, keyword);
  }

  /** Records a START for `to` (the table, then the cache). Throws when the table cannot be written. */
  static async recordOptIn(tenantId: string, to: string, keyword = 'START'): Promise<void> {
    await recordOptOutState(tenantId, to, false, keyword);
  }

  /**
   * Handle an inbound SMS keyword (carrier reply). STOP/UNSUBSCRIBE/IPTAL/DUR opts
   * the sender out; START/UNSTOP/BASLA opts back in. Returns the action taken. Throws
   * when the opt-out table cannot be written, so the caller can answer an error and
   * the carrier redelivers the reply (an opt-out is never acknowledged and lost).
   */
  static async handleInboundKeyword(tenantId: string, from: string, text: string): Promise<'opted_out' | 'opted_in' | 'none'> {
    const action = keywordAction(text);
    if (!action) return 'none';
    if (!(await recordOptOutState(tenantId, from, action.optedOut, action.keyword))) return 'none';
    return action.optedOut ? 'opted_out' : 'opted_in';
  }

  /**
   * Tenant disabled SMS or recipient opted out → must not send. An opt-out state that cannot be read: at enqueue the job is queued anyway (the
   * worker asks again at delivery); at delivery it throws, so nothing is sent and the job fails (D254).
   */
  private static async isSuppressed(tenantId: string, to: string, at: 'enqueue' | 'delivery'): Promise<boolean> {
    if (!(await NotificationSmsQueueService.isSmsEnabled(tenantId))) {
      Logger.info(`[sms] suppressed: SMS disabled for tenant ${tenantId}`);
      return true;
    }
    let optedOut: boolean;
    try {
      optedOut = await NotificationSmsQueueService.isOptedOut(tenantId, to);
    } catch (err) {
      if (!(err instanceof SmsOptOutUnknownError) || at === 'delivery') throw err;
      Logger.warn(`[sms] opt-out state of a recipient of tenant ${tenantId} could not be read at enqueue; the worker checks again before sending`);
      return false;
    }
    if (optedOut) {
      Logger.info(`[sms] suppressed: ${to} has opted out (STOP)`);
      return true;
    }
    return false;
  }

  /**
   * The recorded result of a send whose idempotency key already completed (the record `RedisIdempotencyService.run`
   * keeps in the worker and in `sendShortMessageDirect`), or undefined. Asked before the feature gate: a redelivered
   * send that already went out returns what it returned then, and is never refused for a quota spent since.
   */
  static async completedSend(tenantId: string, idempotencyKey?: string): Promise<{ result: unknown } | undefined> {
    if (!idempotencyKey) return undefined;
    const record = await RedisIdempotencyService.get(tenantId, idempotencyKey);
    return record?.status === 'completed' ? { result: record.response?.body } : undefined;
  }

  static async sendShortMessage(
    tenantId: string,
    { to, body, provider, idempotencyKey }: { to: string; body: string; provider?: SMSProviderType; idempotencyKey?: string },
  ): Promise<void> {
    if (!to?.trim() || !body?.trim()) {
      Logger.warn('NotificationSmsQueueService: Missing phone number or message body.');
      return;
    }
    // already sent under this key: nothing to enqueue, no quota to ask, and no rate-limit slot to take
    if (await NotificationSmsQueueService.completedSend(tenantId, idempotencyKey)) return;
    await NotificationSmsQueueService.assertSmsFeatureAccess(tenantId);
    if (await NotificationSmsQueueService.isSuppressed(tenantId, to, 'enqueue')) return;
    try {
      const rateLimitKey = `${NotificationSmsQueueService.RATE_LIMIT_PREFIX}${tenantId}:${to}`;
      const existing = await redis.get(rateLimitKey);
      if (existing) {
        Logger.warn(`NotificationSmsQueueService: Rate limit hit for ${to}. Message not queued.`);
        return;
      }
      await redis.set(rateLimitKey, '1', 'EX', NotificationSmsQueueService.RATE_LIMIT_SECONDS);
      await NotificationSmsQueueService.QUEUE.add('sendShortMessage', { tenantId, to, body, provider, idempotencyKey },
        idempotencyKey ? { jobId: `sms:${tenantId}:${idempotencyKey}` } : undefined);
      Logger.info(`NotificationSmsQueueService: Queued SMS to ${to}`);
    } catch (error: unknown) {
      Logger.error(`NotificationSmsQueueService.sendShortMessage error: ${error instanceof Error ? error.message : error}`);
    }
  }

  static async sendShortMessageDirect(
    tenantId: string,
    { to, body, provider, idempotencyKey }: { to: string; body: string; provider?: SMSProviderType; idempotencyKey?: string },
  ): Promise<SMSResult | void> {
    const done = await NotificationSmsQueueService.completedSend(tenantId, idempotencyKey);
    if (done) return done.result as SMSResult | void;
    await NotificationSmsQueueService.assertSmsFeatureAccess(tenantId);
    return RedisIdempotencyService.run(tenantId, idempotencyKey, () =>
      NotificationSmsQueueService._sendShortMessage({ tenantId, to, body, provider }),
    );
  }

  private static async _sendShortMessage({
    tenantId, to, body, provider: explicitProvider,
  }: SMSJobData): Promise<SMSResult | void> {
    if (!to?.trim() || !body?.trim()) {
      Logger.warn('NotificationSmsQueueService: Missing phone number or message body.');
      return;
    }
    // Re-assert at the worker boundary to catch plan downgrades during queue delay.
    await NotificationSmsQueueService.assertSmsFeatureAccess(tenantId);

    const parsed = NotificationSmsProviderService.parsePhoneNumber(to);
    if (!parsed) {
      Logger.error(`NotificationSmsQueueService: Invalid phone number format for ${to}`);
      return;
    }
    const { number, regionCode } = parsed;

    // Opt-out / disable can change between enqueue and delivery — re-check.
    if (await NotificationSmsQueueService.isSuppressed(tenantId, number, 'delivery')) return;

    if (!(await NotificationSmsProviderService.isAllowedCountryForTenant(tenantId, regionCode))) {
      Logger.error(`NotificationSmsQueueService: Country ${regionCode} is not allowed for number: ${to}`);
      return;
    }

    const provider = explicitProvider
      ? await NotificationSmsProviderService.getProvider(tenantId, explicitProvider)
      : await NotificationSmsProviderService.getProviderForRegion(tenantId, regionCode);

    const { default: NotificationSmsDeliveryService } = await import('./notification_sms.delivery.service');

    // Circuit breaker: skip a provider that has been failing (cooldown window).
    if (!(await NotificationSmsDeliveryService.isProviderHealthy(tenantId, provider.name))) {
      Logger.warn(`[sms] provider ${provider.name} breaker open — skipping send to ${number}`);
      await NotificationLogService.log(tenantId, 'sms', number, 'failed', { provider: provider.name, error: 'provider_circuit_open' });
      return { success: false, error: 'provider_circuit_open' };
    }

    let result: SMSResult;
    try {
      result = await provider.sendShortMessage(tenantId, { to: number, body });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await NotificationSmsDeliveryService.recordProviderResult(tenantId, provider.name, false);
      await NotificationLogService.log(tenantId, 'sms', number, 'failed', { provider: provider.name, error: message });
      throw err;
    }

    await NotificationSmsDeliveryService.recordProviderResult(tenantId, provider.name, Boolean(result?.success));
    if (result?.success) {
      // Phase 53.5: only what the platform's provider sent counts against the plan; an unreadable answer counts (never a free send).
      if (await isPlatformServed(tenantId, 'sms:provider').catch(() => true)) await TenantUsageService.incrementSmsSends(tenantId, 1);
      await NotificationLogService.log(tenantId, 'sms', number, 'sent', {
        provider: provider.name, providerMessageId: result.messageId,
      });
    } else {
      await NotificationLogService.log(tenantId, 'sms', number, 'failed', {
        provider: provider.name, error: result?.error,
      });
    }
    return result;
  }
}

/** Boot-task entry (`common:boot_task`, consumer phase): starts the SMS consumer. */
export async function startSmsWorker(): Promise<void> {
  NotificationSmsQueueService.startWorker();
}
