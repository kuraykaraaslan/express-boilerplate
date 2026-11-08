import { env } from '@kuraykaraaslan-labs/env';
import { installBrand } from '@kuraykaraaslan-labs/common/server/install-config/install-config.brand';
import Logger from '@kuraykaraaslan-labs/logger';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service';
import NotificationLogService from '@kuraykaraaslan-labs/notification_log/server/notification_log.service';
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { isPlatformServed } from '@kuraykaraaslan-labs/common/server/external-extensions';
import type { MailAttachment, MailOptions, MailResult } from './providers/base.provider';

/** A provider answer of `success:false`, thrown inside the idempotency guard so the claim is released, not stored. */
export class MailNotSentError extends Error {
  constructor(readonly result: MailResult) {
    super(result.error ?? 'Mail not sent');
    this.name = 'MailNotSentError';
  }
}

async function sentOrThrow(pending: Promise<MailResult>): Promise<MailResult> {
  const result = await pending;
  if (!result.success) throw new MailNotSentError(result);
  return result;
}
import NotificationMailProviderService, { type MailProviderType } from './notification_mail.provider.service';
import { RedisIdempotencyService } from '@kuraykaraaslan-labs/redis_idempotency';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  decodeMailAttachments, encodeMailAttachments, normaliseMailAttachments, type QueuedMailAttachment,
} from './notification_mail.attachments';
import {
  loadMailAttachments, MAIL_ATTACHMENT_TTL_SECONDS, MailAttachmentsExpiredError, storeMailAttachments,
} from './notification_mail.attachment-store';

/**
 * The parts of a message a caller may set beyond "who, what, body".
 *
 * A seventh positional argument rather than a signature change because
 * `sendMail` has 44 call sites across 25 modules; anything but an optional
 * trailing parameter is a tree-wide edit for the benefit of two new callers.
 *
 * `attachments` are encoded as base64 (a Buffer does not survive the Redis JSON
 * round trip) and stored ONCE per tenant and content under a key with a TTL
 * (`notification_mail.attachment-store`); the job carries only the reference,
 * and the worker loads and decodes the files. At most 10 files and 7 MiB
 * together; a file with a `cid` is an inline image.
 */
export interface MailSendExtras {
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
}

interface MailJobData {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
  provider?: MailProviderType;
  idempotencyKey?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Files inline in the job: only jobs enqueued by an older build; new jobs carry `attachmentsRef`. */
  attachments?: QueuedMailAttachment[];
  /** SHA-256 of the stored files (`notification_mail.attachment-store`), read under this job's `tenantId`. */
  attachmentsRef?: string;
}

/** What `_sendMail` takes: the job, with its files already decoded. */
type MailSend = Omit<MailJobData, 'attachments' | 'attachmentsRef' | 'idempotencyKey'> & { attachments?: MailAttachment[] };

/**
 * Headers a caller may never set through `MailOptions.headers`.
 *
 * `Bcc`/`Cc`/`To` would add silent recipients; `From`/`Return-Path` would forge
 * the sender past whatever the provider authenticated; `Content-*` would fight
 * the provider over encoding and can hide a second body.
 */
const FORBIDDEN_HEADERS = new Set([
  'bcc', 'cc', 'to', 'from', 'return-path', 'sender',
  'content-type', 'content-transfer-encoding', 'content-disposition', 'mime-version',
]);

/** RFC 5322 field name: printable US-ASCII except colon. */
const HEADER_NAME_RE = /^[!-9;-~]+$/;

/**
 * Reject header injection at the ONE point every provider is reached through.
 *
 * This has to live host-side rather than in each plugin. The JSON providers are
 * closed by construction — a newline inside a JSON string value cannot escape
 * the field — but the SMTP path is not: `smtp.capability.ts` hands headers to
 * nodemailer verbatim, and a `\r\n` in a value ends the header and starts
 * whatever the caller wrote next. That is classic CRLF header injection, and
 * the only safe place to stop it is before the provider is chosen.
 *
 * Throws rather than stripping: a caller that asked for a header we refuse has
 * a bug, and silently sending a different message than the one requested is how
 * that bug survives to production.
 */
export function sanitizeMailHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim();
    const value = String(rawValue ?? '');
    if (!HEADER_NAME_RE.test(name)) {
      throw new AppError(`Invalid mail header name: ${JSON.stringify(rawName)}`, 422, ErrorCode.VALIDATION_ERROR);
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new AppError(`Mail header not allowed: ${name}`, 422, ErrorCode.VALIDATION_ERROR);
    }
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new AppError(`Mail header contains a line break: ${name}`, 422, ErrorCode.VALIDATION_ERROR);
    }
    out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

const MAIL_WORKER_SLOT = Symbol.for('nb.worker.mailQueue');
const mailWorkerStore = globalThis as typeof globalThis & { [MAIL_WORKER_SLOT]?: Worker<MailJobData> };

export default class NotificationMailQueueService {


  static readonly QUEUE_NAME = 'mailQueue';

  // The installation's config/brand.ts (mail sender name, else product name) wins over the env default
  // (docs/phases/45-install-config D45-2).
  static readonly APPLICATION_NAME = installBrand().mailSenderName || env.APPLICATION_NAME || 'Next Boilerplate';
  static readonly APPLICATION_HOST = env.APPLICATION_HOST || 'http://localhost:3000';
  static readonly MAIL_FROM = env.MAIL_FROM || `${NotificationMailQueueService.APPLICATION_NAME} <noreply@example.com>`;

  static readonly FRONTEND_URL                 = NotificationMailQueueService.APPLICATION_HOST;
  static readonly FRONTEND_LOGIN_PATH          = env.FRONTEND_LOGIN_PATH || '/auth/login';
  static readonly FRONTEND_REGISTER_PATH       = env.FRONTEND_REGISTER_PATH || '/auth/register';
  static readonly FRONTEND_PRIVACY_PATH        = env.FRONTEND_PRIVACY_PATH || '/privacy';
  static readonly FRONTEND_TERMS_PATH          = env.FRONTEND_TERMS_PATH || '/terms-of-use';
  static readonly FRONTEND_RESET_PASSWORD_PATH = env.FRONTEND_RESET_PASSWORD_PATH || '/auth/reset-password';
  static readonly FRONTEND_FORGOT_PASSWORD_PATH = env.FRONTEND_FORGOT_PASSWORD_PATH || '/auth/forgot-password';
  static readonly FRONTEND_SUPPORT_EMAIL       = env.FRONTEND_SUPPORT_EMAIL || 'support@example.com';
  static readonly INFORM_MAIL = env.INFORM_MAIL;
  static readonly INFORM_NAME = env.INFORM_NAME;

  static readonly QUEUE = new Queue<MailJobData>(NotificationMailQueueService.QUEUE_NAME, {
    connection: getBullMQConnection(),
  });

  /**
   * Starts the mail consumer. Called from the `common:boot_task` consumer phase,
   * never at import, so a process that only enqueues does not consume; the
   * worker registers a drain so SIGTERM waits for the send in flight. The
   * globalThis slot keeps it to one per process across bundle layers. Idempotent.
   */
  static startWorker(): Worker<MailJobData> {
    const existing = mailWorkerStore[MAIL_WORKER_SLOT];
    if (existing) return existing;
    const worker = new Worker<MailJobData>(
      NotificationMailQueueService.QUEUE_NAME,
      async (job: Job<MailJobData>) => {
        const { tenantId, to, subject, html, provider, idempotencyKey, replyTo, headers } = job.data;
        Logger.info(`MAIL Worker processing job ${job.id}...`);
        // Checked again: a job read from Redis is untrusted input.
        const attachments = decodeMailAttachments(await NotificationMailQueueService.queuedAttachments(job));
        // Worker retries (attempts: 4) must not re-send a mail the provider already
        // accepted: guard the actual send on the idempotency key when supplied.
        // A provider refusal (`success:false`) throws, so the claim is released
        // and BullMQ retries it, instead of a failure stored as "completed" (contact.63).
        await RedisIdempotencyService.run(tenantId, idempotencyKey, () =>
          sentOrThrow(NotificationMailQueueService._sendMail({ tenantId, to, subject, html, provider, replyTo, headers, attachments })),
        );
      },
      { connection: getBullMQConnection(), concurrency: 5 },
    );
    worker.on('completed', (job: Job<MailJobData>) => {
      Logger.info(`MAIL Worker completed job ${job.id}`);
    });
    worker.on('failed', (job: Job<MailJobData> | undefined, err: Error) => {
      Logger.error(`MAIL Worker failed job ${job?.id ?? 'unknown'}: ${err.message}`);
    });
    mailWorkerStore[MAIL_WORKER_SLOT] = worker;
    registerWorkerDrain(worker);
    return worker;
  }

  /**
   * The job's encoded files: loaded by reference (new jobs) or read inline (jobs from an older build). Files that
   * expired before the job ran fail it for good: it is logged as a failed mail and BullMQ is told not to retry.
   */
  private static async queuedAttachments(job: Job<MailJobData>): Promise<QueuedMailAttachment[] | undefined> {
    const { tenantId, to, subject, attachmentsRef } = job.data;
    if (attachmentsRef === undefined) return job.data.attachments;
    try {
      return await loadMailAttachments(tenantId, attachmentsRef);
    } catch (err) {
      if (err instanceof MailAttachmentsExpiredError) {
        (job as { discard?: () => void }).discard?.();
        await NotificationLogService.log(tenantId, 'mail', to, 'failed', { subject, error: err.message }).catch(() => undefined);
      }
      throw err;
    }
  }

  static async assertMailFeatureAccess(tenantId: string): Promise<void> {
    if (isRootTenant(tenantId)) return;
    await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_EMAIL_SEND);
    // Phase 53.5: the plan's monthly quota counts what the platform's provider sends; a tenant's own provider is not the plan's.
    if (!(await isPlatformServed(tenantId, 'mail:provider'))) return;
    const usage = await TenantUsageService.getUsage(tenantId);
    await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_EMAIL_MONTHLY_QUOTA, usage.emailSends);
  }

  /**
   * Read-only headroom of the monthly mail quota, with the same gate and usage read as `assertMailFeatureAccess`; counts
   * nothing and writes no audit row (the channel's `quota`, G-137). `reason` tells a spent quota from a plan without access.
   */
  static async monthlyQuota(tenantId: string): Promise<{ allowed: boolean; key: string; reason?: 'spent' | 'no_access' }> {
    const key = FEATURE_KEYS.FEATURE_EMAIL_MONTHLY_QUOTA;
    if (isRootTenant(tenantId)) return { allowed: true, key };
    if (!(await isPlatformServed(tenantId, 'mail:provider'))) return { allowed: true, key }; // the tenant's own provider (phase 53.5)
    const usage = await TenantUsageService.getUsage(tenantId);
    const r = await FeatureGateService.checkFeatureAccess(tenantId, key, usage.emailSends, { audit: false });
    if (r.allowed) return { allowed: true, key };
    // a BOOLEAN answer for a LIMIT key means no live plan named it (undeclared, or no live plan): not a spent quota
    return { allowed: false, key, reason: r.type === 'BOOLEAN' || r.limit === 0 ? 'no_access' : 'spent' };
  }

  /**
   * The recorded result of a send whose idempotency key already completed (the record `RedisIdempotencyService.run`
   * keeps in the worker and in `sendMailDirect`), or undefined. Asked before the feature gate: a redelivered send that
   * already went out returns what it returned then, and is never refused for a quota spent since.
   */
  static async completedSend(tenantId: string, idempotencyKey?: string): Promise<{ result: unknown } | undefined> {
    if (!idempotencyKey) return undefined;
    const record = await RedisIdempotencyService.get(tenantId, idempotencyKey);
    return record?.status === 'completed' ? { result: record.response?.body } : undefined;
  }

  static async sendMail(
    tenantId: string, to: string, subject: string, html: string, provider?: MailProviderType,
    idempotencyKey?: string, extras?: MailSendExtras,
  ): Promise<void> {
    try {
      // already sent under this key: nothing to enqueue (BullMQ's job id would refuse it anyway), and no quota to ask
      if (await NotificationMailQueueService.completedSend(tenantId, idempotencyKey)) return;
      await NotificationMailQueueService.assertMailFeatureAccess(tenantId);
      // Sanitised here as well as in `_sendMail`, so a bad header is a 422 to the
      // caller instead of a job that fails four times in a worker nobody watches.
      const headers = sanitizeMailHeaders(extras?.headers);
      // Base64 (a Buffer does not survive Redis JSON); checked here too, for the same reason. Stored once under a
      // TTL'd key and referenced, so the bytes are neither copied into every recipient's job nor kept with the
      // job's history.
      const attachments = encodeMailAttachments(extras?.attachments);
      const attachmentsRef = attachments ? await storeMailAttachments(tenantId, attachments) : undefined;
      await NotificationMailQueueService.QUEUE.add('sendMail', {
        tenantId, to, subject, html, provider, idempotencyKey, replyTo: extras?.replyTo, headers,
        ...(attachmentsRef && { attachmentsRef }),
      }, {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5000 },
        // A mail with files is not kept once sent, and a failed one only as long as its files exist (it cannot be
        // retried after that). The send itself is still guarded by the idempotency key in the worker.
        removeOnComplete: attachmentsRef ? true : 1000,
        removeOnFail: attachmentsRef ? { age: MAIL_ATTACHMENT_TTL_SECONDS, count: 1000 } : 5000,
        // Same key → BullMQ refuses the duplicate enqueue (first-line dedupe).
        ...(idempotencyKey ? { jobId: `mail:${tenantId}:${idempotencyKey}` } : {}),
      });
    } catch (error: unknown) {
      Logger.error(`MAIL sendMail ERROR: ${to} ${subject} ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async sendMailDirect(
    tenantId: string, to: string, subject: string, html: string, provider?: MailProviderType,
    idempotencyKey?: string, extras?: MailSendExtras,
  ): Promise<MailResult> {
    const done = await NotificationMailQueueService.completedSend(tenantId, idempotencyKey);
    if (done) return done.result as MailResult;
    await NotificationMailQueueService.assertMailFeatureAccess(tenantId);
    const headers = sanitizeMailHeaders(extras?.headers);
    const attachments = normaliseMailAttachments(extras?.attachments);
    // contact.63: a `success:false` answer is returned to the caller but never
    // stored as the completed result of the key. Stored, it was replayed for 24 h
    // and a retry with the same key never reached the provider again.
    try {
      return await RedisIdempotencyService.run(tenantId, idempotencyKey, () =>
        sentOrThrow(NotificationMailQueueService._sendMail({
          tenantId, to, subject, html, provider, replyTo: extras?.replyTo, headers, attachments,
        })),
      );
    } catch (error) {
      if (error instanceof MailNotSentError) return error.result;
      throw error;
    }
  }

  private static async _sendMail(
    { tenantId, to, subject, html, provider: providerName, replyTo, headers, attachments }: MailSend,
  ): Promise<MailResult> {
    await NotificationMailQueueService.assertMailFeatureAccess(tenantId);
    const provider = await NotificationMailProviderService.getProvider(tenantId, providerName);
    const from = await NotificationMailProviderService.resolveFrom(tenantId);
    // Re-sanitised: a job enqueued by an older build, or replayed from Redis,
    // reaches this line without having passed the check above.
    const options: MailOptions = {
      to, subject, html, from, replyTo, headers: sanitizeMailHeaders(headers),
      ...(attachments && { attachments }),
    };
    let result: MailResult;
    try {
      result = await provider.sendMail(tenantId, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await NotificationLogService.log(tenantId, 'mail', to, 'failed', { subject, provider: provider.name, error: message });
      throw err;
    }
    if (result.success) {
      // Phase 53.5: only what the platform's provider sent counts against the plan; an unreadable answer counts (never a free send).
      if (await isPlatformServed(tenantId, 'mail:provider').catch(() => true)) {
        await TenantUsageService.incrementEmailSends(tenantId, 1).catch((err) => {
          Logger.warn(`_sendMail usage increment failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      await NotificationLogService.log(tenantId, 'mail', to, 'sent', {
        subject, provider: provider.name, providerMessageId: result.messageId,
      }).catch((err) => {
        Logger.warn(`_sendMail notification log failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    } else {
      await NotificationLogService.log(tenantId, 'mail', to, 'failed', {
        subject, provider: provider.name, error: result.error,
      }).catch((err) => {
        Logger.warn(`_sendMail notification log failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    return result;
  }
}

/** Boot-task entry (`common:boot_task`, consumer phase): starts the mail consumer. */
export async function startMailWorker(): Promise<void> {
  NotificationMailQueueService.startWorker();
}
