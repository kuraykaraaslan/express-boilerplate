import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantPurgeRetentionLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.purge_retention';

export const TENANT_PURGE_RETENTION_POINT = 'tenant:purge_retention';

/**
 * One stored object a module must still keep after its tenant is purged, or every object under one key prefix (for a
 * module that keeps a whole folder, so it never has to list millions of keys). `retainUntil` is when the retention
 * ends; `reason` is stored with the file ("<module>: <why>").
 */
export type PurgeRetentionHold =
  | { storageKey: string; retainUntil: Date; reason: string }
  | { storageKeyPrefix: string; retainUntil: Date; reason: string };

/**
 * `(tenantId) => Promise<PurgeRetentionHold[]>` — what the module must still keep. Answer only holds that run past now;
 * an empty list keeps nothing. Throw when you cannot answer: the purge then deletes no file of the tenant this run.
 */
export type TenantPurgeRetention = (tenantId: string) => Promise<PurgeRetentionHold[]>;

export type PurgeRetentionAnswer =
  | { ok: true; holds: PurgeRetentionHold[] }
  | { ok: false; reason: string };

const MALFORMED = 'the contribution is not a function';

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A well-formed hold: exactly one of key / prefix, a real date and a reason. Anything else is a broken answer, not "keep nothing". */
function isHold(v: unknown): v is PurgeRetentionHold {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  if (isText(h.storageKey) === isText(h.storageKeyPrefix)) return false;
  return h.retainUntil instanceof Date && !Number.isNaN(h.retainUntil.getTime()) && isText(h.reason);
}

const isHoldList = (v: unknown): boolean => Array.isArray(v) && v.every(isHold);

/**
 * "Which of this tenant's stored files must outlive its purge?" — every contributor's holds, merged.
 *
 * Data gate (EXT-1): a statutory retention does not end because the module was switched off, so every contributor
 * whose data still exists answers, whatever its state for the tenant.
 *
 * Fails CLOSED, like `tenant:deletion_guard` and for the same reason: "I cannot answer" is not "keep nothing", and a
 * file deleted on a wrong "nothing" cannot be brought back. A contributor that does not load, is not a function,
 * throws, times out, is quarantined or answers something other than a hold list makes the whole answer `ok: false`;
 * the caller then deletes no file of the tenant on this run. Checked here as well as through the point's declared
 * `onFailure`, so a registry without the declaration (a test double) cannot turn a failure into "no holds".
 */
export async function askPurgeRetention(tenantId: string): Promise<PurgeRetentionAnswer> {
  try {
    const { results, failed } = await ext.aggregate<TenantPurgeRetention, PurgeRetentionHold[]>(
      TENANT_PURGE_RETENTION_POINT, tenantCtx(tenantId), tenantPurgeRetentionLoaders,
      async (retained) => {
        if (typeof retained !== 'function') throw new Error(MALFORMED);
        return retained(tenantId);
      },
      { validate: isHoldList },
    );
    if (failed.length > 0) return { ok: false, reason: failed.map((f) => `${f.moduleId} ${f.reason}: ${f.message}`).join('; ') };
    // The stored reason names the module that keeps the file, whatever the contributor wrote.
    return { ok: true, holds: results.flatMap((r) => r.value.map((h) => ({ ...h, reason: `${r.contribution.moduleId}: ${h.reason}` }))) };
  } catch (err) {
    // ContributionFailedError (the declared fail-closed) or anything the runtime itself threw: no answer either way.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The hold that keeps `key`, or null when nothing does. Holds that end at or before `now` keep nothing; when several
 * cover one key (an exact key and a prefix, two modules), the one that runs longest wins, with its reason.
 */
export function retentionMatcher(holds: readonly PurgeRetentionHold[], now: Date): (key: string) => { retainUntil: Date; reason: string } | null {
  const byKey = new Map<string, { retainUntil: Date; reason: string }>();
  const prefixes: Array<{ prefix: string; retainUntil: Date; reason: string }> = [];
  for (const h of holds) {
    if (h.retainUntil.getTime() <= now.getTime()) continue;
    if ('storageKey' in h && h.storageKey) {
      const had = byKey.get(h.storageKey);
      if (!had || had.retainUntil < h.retainUntil) byKey.set(h.storageKey, { retainUntil: h.retainUntil, reason: h.reason });
    } else if ('storageKeyPrefix' in h) {
      prefixes.push({ prefix: h.storageKeyPrefix, retainUntil: h.retainUntil, reason: h.reason });
    }
  }
  return (key) => {
    let best = byKey.get(key) ?? null;
    for (const p of prefixes) {
      if (key.startsWith(p.prefix) && (!best || best.retainUntil < p.retainUntil)) best = { retainUntil: p.retainUntil, reason: p.reason };
    }
    return best;
  };
}
