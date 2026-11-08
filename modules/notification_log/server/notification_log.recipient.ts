import { And, Any, ILike, In, Like, MoreThan, Not, Or, type FindOptionsWhere, type Repository } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { tenantKeys } from '@kuraykaraaslan-labs/db/server/db.tenant-keys.service';
import { normaliseBlindIndexValue } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';
import { NotificationLog } from './entities/notification_log.entity';

/**
 * `notification_logs.recipient` under the tenant's data key (P7-TDEK, decision F16; declared in notification_log.tenant-key-columns.ts).
 *
 *  - Write: the recipient is sealed under the tenant's ACTIVE key and its keyed blind index goes to `recipientHash` (both left as they are on a
 *    node that cannot hold tenant keys: plaintext, no index, the legacy shape).
 *  - Lookup by value (the exact filter, the erasure): `recipientHash` among the indexes under every key the node can still open, OR the plaintext
 *    column equal to the value (dual read: legacy rows until the online backfill moves them), OR one of the tenant's rows whose recipient is an
 *    envelope under the NODE key (v1, or v2 not under a tenant key), opened and compared here. Those are what a migration import writes: the bundle
 *    carries the recipient in clear and the target seals it under its own node key, while the row's `recipientHash` is still the SOURCE node's
 *    index under the source's tenant key, so neither of the first two branches can match it until the backfill reseals the row and recomputes the
 *    index. Without the third branch the erasure would silently miss a migrated tenant's rows on its new node. It reads only the rows not yet
 *    moved by the backfill, in pages; a sealed value never equals a plaintext.
 *  - Substring search reaches legacy plaintext rows and node-key envelopes (opened here), never a tenant-key envelope (it has no substrings); it
 *    also matches the exact value through the index.
 *  - Read: opened in the row tenant's context only; a value that does not open (another tenant's key, a destroyed key) reads `[unreadable]`.
 */
export const RECIPIENT_INDEX_PURPOSE = 'notification_log.recipient';
export const REDACTED = '[redacted]';
export const UNREADABLE = '[unreadable]';

/** The form the blind index is computed over (db's shared normalisation): case and surrounding space never split one recipient into two. */
export const normaliseRecipient = normaliseBlindIndexValue;

export async function sealRecipient(tenantId: string, recipient: string): Promise<{ recipient: string; recipientHash: string | null }> {
  const recipientHash = await tenantKeys.blindIndex(tenantId, RECIPIENT_INDEX_PURPOSE, normaliseRecipient(recipient));
  return { recipient: await tenantKeys.encryptOpt(tenantId, recipient), recipientHash };
}

/** A recipient sealed under the node key, not under a tenant key: a v1 envelope, or a v2 envelope whose kid is not a tenant key's. */
export const NODE_KEY_ENVELOPE = Or(Like('v1.%'), And(Like('v2.%'), Not(Like('v2.tdek-%'))));
const ENVELOPE_PAGE = 500;

/**
 * The ids of the tenant's rows within `base` whose recipient is a node-key envelope that opens to `recipient` (normalised as the blind index is);
 * with `substring`, whose opened recipient contains it (case-insensitive). Paged by id; a value that does not open is skipped.
 */
export async function nodeKeyEnvelopeMatches(
  tenantId: string, recipient: string, base: FindOptionsWhere<NotificationLog>, opts: { substring?: boolean } = {},
): Promise<string[]> {
  const wanted = opts.substring ? recipient.toLowerCase() : normaliseRecipient(recipient);
  const hit = (plain: string) => (opts.substring ? plain.toLowerCase().includes(wanted) : normaliseRecipient(plain) === wanted);
  return withTenantRepositoryFor(tenantId, NotificationLog, async (repo: Repository<NotificationLog>) => {
    const ids: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page: Array<Pick<NotificationLog, 'notificationLogId' | 'recipient'>> = await repo.find({
        where: { ...base, tenantId, recipient: NODE_KEY_ENVELOPE, ...(after ? { notificationLogId: MoreThan(after) } : {}) },
        select: { notificationLogId: true, recipient: true },
        order: { notificationLogId: 'ASC' },
        take: ENVELOPE_PAGE,
      });
      for (const row of page) {
        const plain = await tenantKeys.decryptOpt(tenantId, row.recipient);
        if (typeof plain === 'string' && hit(plain)) ids.push(row.notificationLogId);
      }
      if (page.length < ENVELOPE_PAGE) return ids;
      after = page[page.length - 1].notificationLogId;
    }
  });
}

/** The OR-conditions (a TypeORM `where` array) that find the rows of `recipient` within `base` (which must carry the tenant). */
export async function recipientConditions(
  tenantId: string, recipient: string, base: FindOptionsWhere<NotificationLog>, opts: { substring?: boolean } = {},
): Promise<FindOptionsWhere<NotificationLog>[]> {
  const hashes = await tenantKeys.blindIndexes(tenantId, RECIPIENT_INDEX_PURPOSE, normaliseRecipient(recipient));
  const plain: FindOptionsWhere<NotificationLog> = { ...base, recipient: opts.substring ? ILike(`%${recipient}%`) : recipient };
  const envelopes = await nodeKeyEnvelopeMatches(tenantId, recipient, base, opts);
  return [
    ...(hashes.length ? [{ ...base, recipientHash: In(hashes) }] : []),
    plain,
    // one array parameter (`= ANY($n)`), never one per row: a substring search on a tenant migrated in before the backfill can match tens of
    // thousands of envelopes, past PostgreSQL's 65535 bind parameters
    ...(envelopes.length ? [{ ...base, notificationLogId: Any(envelopes) }] : []),
  ];
}

export async function openRecipient(tenantId: string, stored: string): Promise<string> {
  if (stored === REDACTED) return stored;
  return (await tenantKeys.decryptOpt(tenantId, stored)) ?? UNREADABLE;
}

/** A row with its recipient opened for the reader, and without the blind index. */
export async function openRow<T extends Pick<NotificationLog, 'tenantId' | 'recipient'> & { recipientHash?: string | null }>(row: T): Promise<Omit<T, 'recipientHash'>> {
  const { recipientHash: _hash, ...rest } = row;
  void _hash;
  return { ...rest, recipient: await openRecipient(row.tenantId, row.recipient) };
}
