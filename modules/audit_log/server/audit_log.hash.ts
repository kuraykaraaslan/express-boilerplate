import { chainedRowHash, chainedRowHashV2, matchChainedRow } from '@kuraykaraaslan-labs/common/server/common.hash-chain';

// PII-ish metadata keys scrubbed during right-to-erasure anonymization. Kept as
// a small constant so the policy is auditable in one place.
const PII_METADATA_KEYS = ['email', 'name', 'fullName', 'firstName', 'lastName', 'phone', 'reason', 'ip', 'ipAddress'] as const;

/**
 * audit_log.08 (fixed 2026-10-20): a key is PII when, lower-cased and stripped of `_` and `-`, it is one of the listed keys or ends in
 * one of the identifying ones (`newEmail`, `phoneNumber`, `ip_address`, `fullname`, `Email`). The exact, case-sensitive list let those
 * survive an erasure. `reason` and `name` match exactly only (a `fileName` or `planName` is not a person).
 */
const PII_EXACT = new Set(['email', 'name', 'fullname', 'firstname', 'lastname', 'phone', 'reason', 'ip', 'ipaddress', 'username', 'displayname']);
const PII_SUFFIXES = ['email', 'phone', 'phonenumber', 'ipaddress', 'fullname', 'firstname', 'lastname', 'useragent'];
export function isPiiKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  return PII_EXACT.has(k) || PII_SUFFIXES.some((s) => k.endsWith(s));
}

/**
 * Deterministic SHA-256 over the canonical row content chained to prevHash.
 *
 * The hashing itself is `common.hash-chain` — the same helper `wallet` and
 * `approval` use, so the three chains cannot drift apart again. The field list
 * and its ORDER stay here: they are this table's contract, and the order is
 * part of every hash already stored.
 *
 * `metadata` is jsonb, which is why canonicalisation exists at all: the same
 * logical row must hash identically whatever order the keys arrived in.
 */
export function computeRowHash(
  prevHash: string | null,
  row: {
    tenantId: string;
    actorId: string | null;
    actorType: string;
    onBehalfOfActorId: string | null;
    action: string;
    severity: string;
    resourceType: string | null;
    resourceId: string | null;
    metadata: unknown;
    createdAt: Date;
    actorTenantId?: string | null;
  },
): string {
  return chainedRowHash(prevHash, {
    tenantId: row.tenantId,
    actorId: row.actorId,
    actorType: row.actorType,
    onBehalfOfActorId: row.onBehalfOfActorId,
    action: row.action,
    severity: row.severity,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    // Appended LAST and only when set (2026-09-11). Every row written before the
    // column existed — and every non-delegated row since — hashes byte-for-byte as
    // it always did, so no stored chain needs rewriting; a delegated row still
    // has its provenance covered, so it cannot be quietly blanked afterwards.
    ...(row.actorTenantId ? { actorTenantId: row.actorTenantId } : {}),
  });
}

// ── the keyed legacy chain (audit_log.02, .11, .12; 2026-10-20) ─────────────────────────────────────────────────────────
/**
 * Rows the JavaScript writer produces since 2026-10-20 are KEYED: `common.hash-chain` v2 (HMAC-SHA256 with the server's chain
 * key), so a row edited in the table cannot be re-chained without the key. They stay `hashVersion` NULL (the database trigger
 * reserves 2 for its own sealed rows); the verifier tells keyed from unkeyed by which hash matches (`matchLegacyRow`).
 *
 * What a keyed row hashes differs from v1 in one place, on purpose: the person-bearing fields (actor, on-behalf-of, metadata,
 * IP address, user agent) enter the row hash as ONE keyed digest, `subjectDigest`, stored on the row. That is what lets
 *  - the IP address and user agent be covered at all (audit_log.12: v1 did not hash them), and
 *  - a right-to-erasure scrub those fields WITHOUT breaking the chain (audit_log.02): the row hash still verifies over the stored
 *    digest, and the scrubbed values are sealed by `erasureSeal`, a keyed HMAC over the row hash and the values left after the
 *    scrub. Anyone without the key can neither edit an unerased row's subject (the digest no longer matches) nor forge an erasure
 *    (the seal cannot be computed).
 */
export interface AuditSubject {
  actorId: string | null;
  onBehalfOfActorId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

const subjectOf = (s: AuditSubject) => ({
  actorId: s.actorId ?? null,
  onBehalfOfActorId: s.onBehalfOfActorId ?? null,
  metadata: s.metadata ?? null,
  ipAddress: s.ipAddress ?? null,
  userAgent: s.userAgent ?? null,
});

/** The keyed digest of a row's person-bearing fields, stored as `subjectDigest`. */
export function auditSubjectDigest(subject: AuditSubject): string {
  return chainedRowHashV2(null, subjectOf(subject));
}

/** The seal an erasure writes over the values it left, bound to the row's hash. */
export function auditErasureSeal(rowHash: string, subject: AuditSubject): string {
  return chainedRowHashV2(rowHash, { erased: subjectOf(subject) });
}

export interface KeyedRowContent {
  tenantId: string;
  actorType: string;
  action: string;
  severity: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: Date | string;
  actorTenantId?: string | null;
  subjectDigest: string;
}

const keyedContent = (row: KeyedRowContent) => ({
  tenantId: row.tenantId,
  actorType: row.actorType,
  action: row.action,
  severity: row.severity,
  resourceType: row.resourceType ?? null,
  resourceId: row.resourceId ?? null,
  createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  actorTenantId: row.actorTenantId ?? null,
  subjectDigest: row.subjectDigest,
});

/** The keyed row hash new legacy-chain rows are written with. */
export function computeKeyedRowHash(prevHash: string | null, row: KeyedRowContent): string {
  return chainedRowHashV2(prevHash, keyedContent(row));
}

/** A stored legacy-chain row as the verifier reads it. */
export interface LegacyChainRow extends AuditSubject {
  tenantId: string;
  actorType: string;
  action: string;
  severity: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: Date | string;
  actorTenantId?: string | null;
  rowHash: string | null;
  subjectDigest?: string | null;
  erasureSeal?: string | null;
}

/**
 * Which writer produced a legacy-chain row linked to `prevHash`: 2 for the keyed writer (its subject verified too: the digest,
 * or the erasure seal once erased), 1 for the unkeyed v1 writer, null when the row was altered.
 */
export function matchLegacyRow(prevHash: string | null, row: LegacyChainRow): 2 | 1 | null {
  if (!row.rowHash) return null;
  if (row.subjectDigest) {
    const keyed = matchChainedRow(prevHash, keyedContent({ ...row, subjectDigest: row.subjectDigest }), row.rowHash);
    if (keyed === 2) {
      const subjectOk = row.erasureSeal
        ? auditErasureSeal(row.rowHash, row) === row.erasureSeal
        : auditSubjectDigest(row) === row.subjectDigest;
      return subjectOk ? 2 : null;
    }
  }
  const v1 = computeRowHash(prevHash, {
    tenantId: row.tenantId, actorId: row.actorId ?? null, actorType: row.actorType, onBehalfOfActorId: row.onBehalfOfActorId ?? null,
    action: row.action, severity: row.severity, resourceType: row.resourceType ?? null, resourceId: row.resourceId ?? null,
    metadata: row.metadata ?? null, createdAt: row.createdAt as Date, actorTenantId: row.actorTenantId ?? null,
  });
  return v1 === row.rowHash ? 1 : null;
}

/**
 * Consent-aware metadata scrubbing: strip common PII keys (recursively) while
 * preserving structural/non-PII fields. Applied during anonymizeActor.
 */
export function scrubMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const piiSet = new Set<string>(PII_METADATA_KEYS as readonly string[]);
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (piiSet.has(k) || isPiiKey(k)) continue; // drop PII key entirely
        out[k] = scrub(v);
      }
      return out;
    }
    return value;
  };
  return scrub(metadata) as Record<string, unknown>;
}
