import { createHash } from 'node:crypto'
import redis from '@kuraykaraaslan-labs/redis'
import type { UploadOrigin } from './storage.dto'
import type { StorageProviderType } from './storage.enums'
import type { UploadResult } from './storage.types'

/**
 * Redis state of browser-direct uploads (presign, PUT to the bucket, complete).
 *
 * The browser PUTs to a STAGING key (`<tenantId>/_direct-uploads/<uuid>`), never
 * to the final one: complete checks the staged bytes and then copies them to the
 * final key, so a client that re-uses its still-valid PUT URL after complete can
 * only overwrite the staging object, never a file that was checked and recorded.
 * Nothing ever records or links a staging key.
 *
 * Only `sha256(uploadId)` is stored (the download-link precedent), so a Redis
 * dump cannot be replayed against the complete route.
 */

/** Folder segment of staging keys. Not a registered storage folder, so no upload path can write there. */
export const STAGING_FOLDER = '_direct-uploads'

/** Grace after a staging key's deadline before the sweep deletes it. */
export const STAGING_SWEEP_GRACE_MS = 15 * 60 * 1000

/** How long one complete call holds its claim (HEAD, leading bytes, copy, audit row). */
export const COMPLETE_CLAIM_TTL_SECONDS = 5 * 60

/** Staging objects to delete once their score (epoch ms) has passed. Member: `<bucket>/<stagingKey>`. */
export const STAGING_INDEX_KEY = 'storage:uploads:staging'

const sessionKey = (hash: string) => `storage:upload:${hash}`
const claimKey = (hash: string) => `storage:upload-claim:${hash}`
const doneKey = (hash: string) => `storage:upload-done:${hash}`

/** Everything complete needs, recorded at presign: the client only ever sends the upload id back. */
export interface DirectUploadSession {
  tenantId: string
  userId?: string
  /** Which complete route may finish the upload ('storage', 'drive'). */
  purpose: string
  /** Consumer data handed back on complete (e.g. Drive's parent folder). */
  meta: Record<string, string | null>
  name: string
  size: number
  mimeType: string
  folder: string
  stagingKey: string
  key: string
  bucket: string
  provider: StorageProviderType
  /** Whose storage account the presign targets (phase 53.5); the completed object's row records it. */
  source?: 'platform' | 'tenant'
  url: string
  /** The cap the declaration was checked against. */
  maxBytes: number
  /** JPEG metadata is stripped on complete (see `storage.direct-upload.ts`). */
  stripExif: boolean
  origin?: UploadOrigin
  createdAt: number
  /** The presigned PUT URL cannot be used after this (epoch ms). */
  urlExpiresAt: number
  /** The session cannot be completed after this (epoch ms). */
  expiresAt: number
}

/** The verified, recorded upload complete hands back (and replays). */
export interface CompletedUpload extends UploadResult {
  mimeType: string
  name: string
  meta: Record<string, string | null>
}

/** A finished upload, kept for the session's lifetime so a retried complete gets the same answer. */
export interface CompletedUploadRecord {
  tenantId: string
  userId?: string
  purpose: string
  upload: CompletedUpload
  /** What the consumer's finalize step returned (e.g. the Drive node). */
  extra?: unknown
}

export function hashUploadId(uploadId: string): string {
  return createHash('sha256').update(uploadId, 'utf8').digest('hex')
}

/** True for a key under the tenant's staging folder: such an object has not been checked and is never served. */
export function isStagingKey(key: string): boolean {
  return typeof key === 'string' && key.split('/')[1] === STAGING_FOLDER
}

const stagingMember = (bucket: string, stagingKey: string) => `${bucket}/${stagingKey}`

function parse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Store a new session. The staging key is indexed for the sweep FIRST: a session
 * whose object could never be cleaned up is worse than a sweep entry for an
 * object that never arrives (deleting a missing key is a no-op).
 */
export async function saveSession(hash: string, session: DirectUploadSession, ttlSeconds: number): Promise<void> {
  await redis.zadd(STAGING_INDEX_KEY, session.expiresAt + STAGING_SWEEP_GRACE_MS, stagingMember(session.bucket, session.stagingKey))
  await redis.set(sessionKey(hash), JSON.stringify(session), 'EX', ttlSeconds, 'NX')
}

export async function readSession(hash: string): Promise<DirectUploadSession | null> {
  return parse<DirectUploadSession>(await redis.get(sessionKey(hash)))
}

/** End a session: it can no longer be completed. */
export async function consumeSession(hash: string): Promise<void> {
  await redis.del(sessionKey(hash))
}

/** Single-flight claim of one complete call; false when another call holds it. */
export async function claimCompletion(hash: string): Promise<boolean> {
  return (await redis.set(claimKey(hash), '1', 'EX', COMPLETE_CLAIM_TTL_SECONDS, 'NX')) === 'OK'
}

export async function releaseCompletion(hash: string): Promise<void> {
  await redis.del(claimKey(hash))
}

export async function saveCompleted(hash: string, record: CompletedUploadRecord, ttlSeconds: number): Promise<void> {
  await redis.set(doneKey(hash), JSON.stringify(record), 'EX', Math.max(1, ttlSeconds))
}

export async function readCompleted(hash: string): Promise<CompletedUploadRecord | null> {
  return parse<CompletedUploadRecord>(await redis.get(doneKey(hash)))
}

/** (Re)schedule the deletion of a staging object at `atMs`. */
export async function scheduleStagingDelete(bucket: string, stagingKey: string, atMs: number): Promise<void> {
  await redis.zadd(STAGING_INDEX_KEY, atMs, stagingMember(bucket, stagingKey))
}

/** Staging objects whose deletion is due, oldest first. */
export async function dueStagingObjects(now: number, limit: number): Promise<Array<{ member: string; bucket: string; key: string }>> {
  const flat = (await redis.zrange(STAGING_INDEX_KEY, 0, limit - 1, 'WITHSCORES')) as string[]
  const due: Array<{ member: string; bucket: string; key: string }> = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (Number(flat[i + 1]) > now) break // sorted by score: nothing later is due either
    const member = flat[i]
    const slash = member.indexOf('/')
    if (slash > 0) due.push({ member, bucket: member.slice(0, slash), key: member.slice(slash + 1) })
    else due.push({ member, bucket: '', key: '' })
  }
  return due
}

export async function forgetStagingObject(member: string): Promise<void> {
  await redis.zrem(STAGING_INDEX_KEY, member)
}
