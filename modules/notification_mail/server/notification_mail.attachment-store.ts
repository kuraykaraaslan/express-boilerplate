import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { QueuedMailAttachment } from './notification_mail.attachments';

/**
 * Where the files of a queued mail wait for the worker (G-076 security review).
 *
 * A mail job used to carry its attachments, so the bytes sat in Redis as long as BullMQ kept the job (the last 1000
 * completed and 5000 failed jobs) and once per recipient: one `action.notify` to twenty people wrote ~27 MiB. Now the
 * encoded files are stored ONCE, under a key named by the tenant and the SHA-256 of their JSON, with a TTL; each
 * recipient's job carries only that hash. The same files sent to many recipients (one notification, one key) are
 * therefore written once and expire on their own, sent or not.
 *
 * The key is built from the job's own `tenantId`, so a job can only ever read its tenant's files, and the worker
 * checks the bytes it loads against the hash before sending them. An expired payload fails the job outright
 * (`MailAttachmentsExpiredError`): retrying cannot bring it back.
 */

/**
 * How long the files wait. The job's own retries take under a minute (4 attempts, 5 s exponential backoff); the
 * rest covers a queue backlog or a worker restart. A job that starts later than this fails rather than sending the
 * mail without its files.
 */
export const MAIL_ATTACHMENT_TTL_SECONDS = 6 * 60 * 60;

const HASH_RE = /^[a-f0-9]{64}$/;

/** The Redis key of a tenant's stored files (the `tenantKey` shape, so a tenant purge finds it). */
export const mailAttachmentKey = (tenantId: string, hash: string) => `tenant:${tenantId}:mail_attachments:${hash}`;

/** The commands used; the client is loaded on first use so a process that never sends a file opens no connection here. */
interface AttachmentRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
}
async function redis(): Promise<AttachmentRedis> {
  return (await import('@kuraykaraaslan-labs/redis/server/redis.service')).default as unknown as AttachmentRedis;
}

/** A stored payload is gone (its TTL ran out before the job ran); the job cannot succeed on a retry. */
export class MailAttachmentsExpiredError extends AppError {
  constructor(hash: string) {
    super(`Mail attachments ${hash.slice(0, 12)}… expired before the mail was sent`, 410, ErrorCode.VALIDATION_ERROR);
    this.name = 'MailAttachmentsExpiredError';
  }
}

/**
 * Stores the encoded files (once per tenant and content) and returns the reference a job carries. Files already
 * stored only get their TTL renewed, so a notification to many recipients sends the bytes to Redis once.
 */
export async function storeMailAttachments(tenantId: string, list: readonly QueuedMailAttachment[]): Promise<string> {
  const json = JSON.stringify(list);
  const hash = createHash('sha256').update(json).digest('hex');
  const key = mailAttachmentKey(tenantId, hash);
  const client = await redis();
  // EXPIRE answers 1 when the key exists: then the payload is already there and nothing large is written. Two
  // concurrent first writers both SET the same bytes, which is harmless.
  if ((await client.expire(key, MAIL_ATTACHMENT_TTL_SECONDS)) !== 1) {
    await client.set(key, json, 'EX', MAIL_ATTACHMENT_TTL_SECONDS);
  }
  return hash;
}

/** The files a job refers to, read from its own tenant's key and checked against the hash. */
export async function loadMailAttachments(tenantId: string, ref: unknown): Promise<QueuedMailAttachment[]> {
  if (typeof ref !== 'string' || !HASH_RE.test(ref)) {
    throw new AppError('Mail attachment reference is malformed', 422, ErrorCode.VALIDATION_ERROR);
  }
  const json = await (await redis()).get(mailAttachmentKey(tenantId, ref));
  if (json === null) throw new MailAttachmentsExpiredError(ref);
  if (createHash('sha256').update(json).digest('hex') !== ref) {
    throw new AppError('Stored mail attachments do not match their reference', 422, ErrorCode.VALIDATION_ERROR);
  }
  const list = JSON.parse(json) as unknown;
  if (!Array.isArray(list)) throw new AppError('Stored mail attachments are not a list', 422, ErrorCode.VALIDATION_ERROR);
  return list as QueuedMailAttachment[];
}
