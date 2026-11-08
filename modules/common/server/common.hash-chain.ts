import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The one tamper-evident row hash.
 *
 * `rowHash = sha256(prevHash + canonical(content))`, where each row links to
 * its predecessor, so any after-the-fact edit breaks the chain from that row
 * onward and a verifier can name where.
 *
 * ## Why this is shared now
 *
 * Three modules had written it independently — `audit_log`, `wallet`,
 * `approval` — and the copies had drifted in a way their own comments hid.
 * Both `wallet` and `approval` describe themselves as mirroring
 * `audit_log.computeRowHash` **and its canonicalisation**, and neither
 * canonicalises anything: they hash `JSON.stringify` of the object as built.
 *
 * Today that is harmless, because both hash only scalars. It stops being
 * harmless the first time either row gains a jsonb column — the same logical
 * content would hash differently depending on key insertion order, and the
 * verifier would report tampering that never happened. That is the worst
 * failure mode an integrity check has: it is believed.
 *
 * ## Byte-compatible with all three, on purpose
 *
 * Every chain in the database was written by one of the three. So this
 * reproduces their output exactly rather than improving on it:
 *
 *  - **Top-level key order is the CALLER's.** `JSON.stringify` follows
 *    insertion order, and sorting here would rewrite every stored hash.
 *  - **Nested objects are key-sorted** (what `audit_log.canonicalize` did),
 *    which is what makes a jsonb column safe.
 *  - **Dates become ISO strings**, which all three did inline.
 *
 * A test pins the equivalence against the three original implementations.
 *
 * ## What is deliberately NOT shared
 *
 * The verifiers. `wallet` walks by `seq` (a real sequence), `audit_log` by
 * `createdAt`, and `approval` follows the `prevHash` links because its rows can
 * tie on the millisecond — sorting there produced the repo's best-known flaky
 * test, and a uuid tie-break made it worse. Those are three different answers
 * to "what order were these written in", each correct for its table. Unifying
 * them would mean picking one table's answer for all three.
 */

/** Sort nested object keys and normalise dates; leave the top level as given. */
function canonicalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Hash one row's content, chained to its predecessor.
 *
 * `content` is the row's immutable, chained fields in the order the module
 * chose — that order is part of the stored hash and must not be changed for an
 * existing chain.
 */
export function chainedRowHash(prevHash: string | null, content: Record<string, unknown>): string {
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) canonical[key] = canonicalizeValue(value);
  return createHash('sha256').update((prevHash ?? '') + JSON.stringify(canonical)).digest('hex');
}

// ── v2: the keyed chain (common.17) ─────────────────────────────────────────────────────────────────────────────────
/**
 * v1 above is an UNKEYED sha256: anyone with write access to the table can rewrite a row and recompute a valid chain from
 * there on. v2 is an HMAC-SHA256 with a server secret over the same input (`prevHash + canonical(content)`), so a rewritten
 * row cannot be re-chained without the key. Same 64-hex shape, so it fits every existing column (approval is varchar(64)).
 *
 * History is not re-hashed: v1 rows stay as written. A verifier asks `matchChainedRow`, which recognises either version,
 * and enforces the one-way rule with `ChainVersionGuard`: once a chain has a v2 row, every later row must be v2 (a forger
 * without the key cannot append v1 rows after the cutover).
 *
 * The key: HASH_CHAIN_KEY, else derived from SETTINGS_ENCRYPTION_KEY or ACCESS_TOKEN_SECRET (a deployment already holds
 * them); development and test fall back to a fixed key, production refuses to hash without one.
 */
function hashChainKey(): Buffer {
  const e = process.env;
  const secret = e.HASH_CHAIN_KEY || e.SETTINGS_ENCRYPTION_KEY || e.ACCESS_TOKEN_SECRET
    || (e.NODE_ENV === 'production' ? '' : 'development-hash-chain-key');
  if (!secret) throw new Error('HASH_CHAIN_KEY is not configured: refusing to write an unkeyed audit chain');
  return createHash('sha256').update(`hash-chain:v2:${secret}`).digest();
}

function canonicalContent(content: Record<string, unknown>): string {
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) canonical[key] = canonicalizeValue(value);
  return JSON.stringify(canonical);
}

/** The v2 (keyed) row hash: what new rows are written with. */
export function chainedRowHashV2(prevHash: string | null, content: Record<string, unknown>): string {
  return createHmac('sha256', hashChainKey()).update((prevHash ?? '') + canonicalContent(content)).digest('hex');
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Which version produced `stored` for this content and predecessor: 2, 1, or null when neither (the row was altered). */
export function matchChainedRow(prevHash: string | null, content: Record<string, unknown>, stored: string | null | undefined): 2 | 1 | null {
  if (!stored) return null;
  if (sameHex(chainedRowHashV2(prevHash, content), stored)) return 2;
  if (sameHex(chainedRowHash(prevHash, content), stored)) return 1;
  return null;
}

/** The one-way rule of a single chain: after its first v2 row, a v1 row is a break. */
export class ChainVersionGuard {
  private seenV2 = false;
  /** True when a row of `version` may follow what this chain has shown so far. */
  accept(version: 2 | 1 | null): boolean {
    if (version === null) return false;
    if (version === 1 && this.seenV2) return false;
    if (version === 2) this.seenV2 = true;
    return true;
  }
}
