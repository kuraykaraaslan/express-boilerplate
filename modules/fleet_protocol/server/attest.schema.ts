import { createHash, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalBytes } from './canonical';
import { signDocument, verifyDocument } from './document';
import { importPublicKey } from './sign';
import { EMPTY_ROOT } from './merkle';

/**
 * Attestations (docs/phases/02-fleet/03 section 8.9, roadmap Phase 5): what a node tells the control plane about its own evidence, what the
 * control plane answers, and the root the control plane publishes. Everything here is class G: integers, hashes, enums and timestamps, never a
 * free string, a tenant name or a label. Pure functions, no I/O.
 *
 * Three documents:
 *  - the attestation BODY, the `body` of an envelope of type `attest` (signed by the node's signing key like any envelope; `ref` = the
 *    attestation id the node chose, and the node resends the same id and body until it holds an ack);
 *  - the ACK the control plane returns (`fleet.attest-ack`), which the node stores and which gates checkpoints;
 *  - the CP AUDIT ROOT the control plane publishes (`fleet.cp-audit-root`), which nodes witness in their next attestation.
 * Acks and roots are domain-separated documents (`document.ts`) signed with the control plane's COMMAND key, so a node verifies both against the
 * `commandKeys` of the trust bundle it already pins, without any bundle schema change. A key that is revoked is refused; a key past `notAfter`
 * is refused for documents signed after it, so a retired key that stays in the bundle keeps vouching for the acks it signed (key rotation must
 * not invalidate stored acks).
 *
 * VERSIONING. `ATTEST_FORMAT_VERSION` is the `v` of every document and payload below. The Merkle rules (merkle.ts) are part of the format. New
 * attestation kinds are new branches of the body union: the kinds are already named and RESERVED, so adding a branch is not a version bump,
 * while any change to an existing payload is.
 */
export const ATTEST_FORMAT_VERSION = 1;

/**
 * Every kind the spec names (02 section 3.4), plus `RESTORE` (09 section PITR, roadmap Phase 8: a node whose audit chains a backup restore rolled back
 * says so, and the control plane resumes its audit line from the restored heads once an operator acknowledged it). Only the ACTIVE ones have a body
 * schema yet; a reserved kind is refused with `reserved_kind`. New kinds are appended, so the order of the older ones never changes.
 */
export const ATTEST_KINDS = [
  'AUDIT_CHAIN_ROOT', 'BACKUP_INVENTORY', 'KEY_INVENTORY', 'DELETION_RECEIPT', 'MIGRATION_RECEIPT', 'EFFECTIVE_POLICY', 'DESTRUCTION_RECEIPT', 'RESTORE',
] as const;
export type AttestKind = (typeof ATTEST_KINDS)[number];
export const ATTEST_ACTIVE_KINDS = ['AUDIT_CHAIN_ROOT', 'BACKUP_INVENTORY', 'KEY_INVENTORY', 'RESTORE'] as const;
export type AttestActiveKind = (typeof ATTEST_ACTIVE_KINDS)[number];
export const ATTEST_RESERVED_KINDS = ['DELETION_RECEIPT', 'MIGRATION_RECEIPT', 'EFFECTIVE_POLICY', 'DESTRUCTION_RECEIPT'] as const;

export const ATTEST_ACK_DOMAIN = 'fleet.attest-ack';
export const CP_AUDIT_ROOT_DOMAIN = 'fleet.cp-audit-root';

// ── scalars ───────────────────────────────────────────────────────────────────

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const kid = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
/** A count that fits a 32-bit column. */
const count = z.number().int().min(0).max(2 ** 31 - 1);
/** A count that can grow past 32 bits (rows ever written, bytes). Always a safe integer: canonical JSON refuses anything else. */
const bigCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** UTC, whole seconds, `Z`: one spelling per instant, so a signed timestamp is never re-serialised differently by a verifier. */
export const IsoSecondsSchema = z.string().regex(ISO_SECONDS).refine((s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) && isoSeconds(t) === s;
}, 'not a real timestamp');

/** The attested spelling of an instant (epoch milliseconds), truncated to the second. */
export function isoSeconds(epochMs: number): string {
  return new Date(Math.floor(epochMs / 1000) * 1000).toISOString().slice(0, 19) + 'Z';
}
/** Epoch seconds of an attested timestamp. */
export function isoSecondsToEpoch(s: string): number {
  return Math.floor(Date.parse(s) / 1000);
}

// ── payloads (G only) ─────────────────────────────────────────────────────────

/** Evidence of the audit chains: the Merkle root over (tenant, head hash, row count) of every chain on the node, plus the node's own tamper counters. */
export const AuditChainRootPayloadSchema = z.object({
  v: z.literal(ATTEST_FORMAT_VERSION),
  /** Root of the tree of `AUDIT_HEAD` leaves (merkle.ts); `EMPTY_ROOT` only when there is no chain. */
  merkleRoot: sha256,
  tenantChainCount: count,
  /** Sum of the rows every chain has ever held (checkpointed rows included), so it never decreases. */
  headCountTotal: bigCount,
  /** The CP root this node last verified and witnessed (mutual witnessing); null until it has seen one. */
  cpRootWitnessed: sha256.nullable(),
  /** `merkleRoot` of the previous AUDIT_CHAIN_ROOT of this node; null for its first. */
  prevRoot: sha256.nullable(),
  /** Chains whose head differs from the previous attestation although the row count did not grow. */
  forkedChainCount: count,
  /** Chains whose row count went down since the previous attestation. */
  headRegressionCount: count,
}).strict().refine((p) => (p.tenantChainCount === 0
  ? p.merkleRoot === EMPTY_ROOT && p.headCountTotal === 0
  : p.merkleRoot !== EMPTY_ROOT && p.headCountTotal >= p.tenantChainCount), 'chain count, row total and root disagree');
export type AuditChainRootPayload = z.infer<typeof AuditChainRootPayloadSchema>;

export const BACKUP_COVERAGES = ['DEPLOYD_STATE', 'FULL'] as const;
export const BACKUP_LOCATIONS = ['LOCAL', 'REMOTE', 'UNKNOWN'] as const;
/**
 * Evidence of the backups. `coverage` says honestly what the inventory is built from: `DEPLOYD_STATE` is only the node helper's record of its last
 * pre-deploy backup (all that exists before a backup tool is integrated), `FULL` a real backup catalogue.
 */
export const BackupInventoryPayloadSchema = z.object({
  v: z.literal(ATTEST_FORMAT_VERSION),
  coverage: z.enum(BACKUP_COVERAGES),
  backupCount: count,
  newestBackupAt: IsoSecondsSchema.nullable(),
  newestSizeBytes: bigCount.nullable(),
  locationClass: z.enum(BACKUP_LOCATIONS),
  /** Hash of the detailed inventory, which stays on the node. */
  inventoryHash: sha256,
}).strict().refine((p) => (p.backupCount === 0) === (p.newestBackupAt === null), 'backup count and newest backup disagree');
export type BackupInventoryPayload = z.infer<typeof BackupInventoryPayloadSchema>;

/** Evidence of the node's keys: how many, how old, how long the TLS certificate lasts. Key ids and fingerprints stay on the node behind `inventoryHash`. */
export const KeyInventoryPayloadSchema = z.object({
  v: z.literal(ATTEST_FORMAT_VERSION),
  keyCount: count,
  oldestKeyAgeDays: count,
  /** Whole days until the TLS certificate expires; 0 once it has. */
  tlsDaysLeft: count,
  /** Fingerprint of the key-encryption-key in use; null when none is. */
  kekFingerprint: sha256.nullable(),
  inventoryHash: sha256,
}).strict();
export type KeyInventoryPayload = z.infer<typeof KeyInventoryPayloadSchema>;

/**
 * A backup restore rolled the node's audit chains back (09, PITR scenario). The node compares the heads it reads after the restore with the heads of its last
 * ACKNOWLEDGED audit attestation and says what was lost, in numbers only. The body's `periodStart` is the restore point and its `periodEnd` the moment the
 * node attested the restore: that span is the period whose writes the restore lost. The control plane stores it, alerts, and signs the ack only once an
 * operator acknowledged it; from then on the node's audit line continues from `newRoot` (the next AUDIT_CHAIN_ROOT names it as `prevRoot`), so the
 * regression the restore caused is not flagged again.
 */
export const RestorePayloadSchema = z.object({
  v: z.literal(ATTEST_FORMAT_VERSION),
  /** The instant the data was restored to (the PITR target, or the time of the backup restored). */
  restorePoint: IsoSecondsSchema,
  /** `merkleRoot` of the newest audit root (or restore) the control plane had acknowledged before the restore; null when the node holds none. */
  lastAckedRoot: sha256.nullable(),
  /** `periodEnd` of that acknowledged attestation; null with `lastAckedRoot`. Acknowledged evidence after `restorePoint` is what the restore rolled back. */
  lastAckedPeriodEnd: IsoSecondsSchema.nullable(),
  /** Root of the tree of the restored `AUDIT_HEAD` leaves (merkle.ts); `EMPTY_ROOT` only when no chain is left. */
  newRoot: sha256,
  tenantChainCount: count,
  headCountTotal: bigCount,
  /** Chains still present whose row count went down against the last acknowledged heads. */
  rolledBackChainCount: count,
  /** Chains of the last acknowledged heads that no longer exist at all. */
  droppedChainCount: count,
  /** Rows the last acknowledged heads held beyond the restored ones (rolled back plus dropped chains). */
  lostRowCount: bigCount,
}).strict()
  .refine((p) => (p.tenantChainCount === 0
    ? p.newRoot === EMPTY_ROOT && p.headCountTotal === 0
    : p.newRoot !== EMPTY_ROOT && p.headCountTotal >= p.tenantChainCount), 'chain count, row total and root disagree')
  .refine((p) => (p.lastAckedRoot === null) === (p.lastAckedPeriodEnd === null), 'last acknowledged root and period disagree')
  .refine((p) => p.lastAckedRoot !== null || (p.rolledBackChainCount === 0 && p.droppedChainCount === 0 && p.lostRowCount === 0), 'losses without an acknowledged base');
export type RestorePayload = z.infer<typeof RestorePayloadSchema>;

export interface AttestPayloads {
  AUDIT_CHAIN_ROOT: AuditChainRootPayload;
  BACKUP_INVENTORY: BackupInventoryPayload;
  KEY_INVENTORY: KeyInventoryPayload;
  RESTORE: RestorePayload;
}

/** sha256 (hex) of the canonical JSON of a payload: the `payloadHash` of the body and of the ack. */
export function attestPayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalBytes(payload)).digest('hex');
}

// ── body ──────────────────────────────────────────────────────────────────────

const bodyBase = {
  v: z.literal(ATTEST_FORMAT_VERSION),
  periodStart: IsoSecondsSchema,
  periodEnd: IsoSecondsSchema,
  payloadHash: sha256,
};
const branch = <K extends AttestActiveKind, P extends z.ZodType>(kind: K, payload: P) =>
  z.object({ ...bodyBase, kind: z.literal(kind), payload }).strict();

const AttestBodyShapeSchema = z.discriminatedUnion('kind', [
  branch('AUDIT_CHAIN_ROOT', AuditChainRootPayloadSchema),
  branch('BACKUP_INVENTORY', BackupInventoryPayloadSchema),
  branch('KEY_INVENTORY', KeyInventoryPayloadSchema),
  branch('RESTORE', RestorePayloadSchema),
]).refine((b) => b.periodStart <= b.periodEnd, 'periodStart is after periodEnd')
  // A restore's period IS the lost span: it starts at the restore point, so the two can never tell different stories.
  .refine((b) => b.kind !== 'RESTORE' || b.periodStart === b.payload.restorePoint, 'a restore period starts at its restore point');

/** The strict body of an `attest` envelope: a discriminated union on `kind`, the payload hash bound to the payload. */
export const AttestBodySchema = AttestBodyShapeSchema.refine((b) => attestPayloadHash(b.payload) === b.payloadHash, 'payloadHash does not match the payload');
export type AttestBody = z.infer<typeof AttestBodySchema>;

export type AttestBodyCheck =
  | { ok: true; body: AttestBody }
  | { ok: false; reason: 'unknown_kind' | 'reserved_kind' | 'bad_payload' | 'hash_mismatch' };

/** Same role as `checkCommandBody` for the `attest` type: says WHY a body was refused, so a caller can tell a reserved kind from a tampered one. */
export function checkAttestBody(raw: unknown): AttestBodyCheck {
  const kind = raw !== null && typeof raw === 'object' ? (raw as { kind?: unknown }).kind : undefined;
  if (typeof kind !== 'string' || !(ATTEST_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'unknown_kind' };
  if ((ATTEST_RESERVED_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'reserved_kind' };
  const shape = AttestBodyShapeSchema.safeParse(raw);
  if (!shape.success) return { ok: false, reason: 'bad_payload' };
  if (attestPayloadHash(shape.data.payload) !== shape.data.payloadHash) return { ok: false, reason: 'hash_mismatch' };
  return { ok: true, body: shape.data };
}

/** Builds a body for a node: computes the payload hash and runs the strict schema, so a node can never sign a body the control plane would refuse. Throws on a bad payload. */
export function buildAttestBody<K extends AttestActiveKind>(input: { kind: K; periodStart: string; periodEnd: string; payload: AttestPayloads[K] }): AttestBody {
  return AttestBodySchema.parse({ v: ATTEST_FORMAT_VERSION, ...input, payloadHash: attestPayloadHash(input.payload) });
}

// ── ack and CP root documents ────────────────────────────────────────────────

/** What the control plane signs to acknowledge one attestation. Binds the node, the kind and the payload hash, so an ack is not reusable for anything else. */
export const AttestAckDocSchema = z.object({
  v: z.literal(ATTEST_FORMAT_VERSION),
  nodeId,
  attestationId: z.uuid(),
  kind: z.enum(ATTEST_KINDS),
  payloadHash: sha256,
  ackedAt: IsoSecondsSchema,
  kid,
}).strict();
export type AttestAckDoc = z.infer<typeof AttestAckDocSchema>;
export const AttestAckSchema = AttestAckDocSchema.extend({ ackSignature: signature }).strict();
export type AttestAck = z.infer<typeof AttestAckSchema>;

/** What the control plane signs to publish its daily audit root. */
export const CpAuditRootDocSchema = z.object({
  v: z.literal(ATTEST_FORMAT_VERSION),
  hash: sha256,
  publishedAt: IsoSecondsSchema,
  kid,
}).strict();
export type CpAuditRootDoc = z.infer<typeof CpAuditRootDocSchema>;
export const CpAuditRootSchema = CpAuditRootDocSchema.extend({ sig: signature }).strict();
export type CpAuditRoot = z.infer<typeof CpAuditRootSchema>;

/** A command key as a trust bundle carries it (`TrustBundleContent.commandKeys`). */
export interface CommandKeySlot { kid: string; publicKey: string; notAfter?: string; revoked?: boolean }

export type DocumentDecision = 'OK' | 'REJECTED_SCHEMA' | 'REJECTED_KID' | 'REJECTED_SIGNATURE' | 'REJECTED_BINDING';

/** The key for `keyId` that may vouch for a document signed at `signedAt`, or null: unknown, revoked, malformed or already expired at that time. */
function commandKey(keys: readonly CommandKeySlot[], keyId: string, signedAt: string): KeyObject | null {
  const slot = keys.find((k) => k.kid === keyId);
  if (!slot || slot.revoked) return null;
  if (slot.notAfter !== undefined) {
    const until = Date.parse(slot.notAfter);
    if (!Number.isFinite(until) || Date.parse(signedAt) > until) return null;
  }
  try { return importPublicKey(slot.publicKey); } catch { return null; }
}

/** Signs an ack with the control plane's command key. The document is validated first: a malformed ack is never signed. */
export function signAttestAck(doc: AttestAckDoc, privateKey: KeyObject): AttestAck {
  const parsed = AttestAckDocSchema.parse(doc);
  return { ...parsed, ackSignature: signDocument(ATTEST_ACK_DOMAIN, parsed, privateKey) };
}

/**
 * Verifies an ack against the command keys of the trust bundle. `expect` binds it to what the caller holds: the node's own id and the root it
 * sent (attestation id, kind, payload hash). A valid signature over some other attestation is `REJECTED_BINDING`.
 */
export function verifyAttestAck(
  raw: unknown, commandKeys: readonly CommandKeySlot[],
  expect: Partial<Pick<AttestAckDoc, 'nodeId' | 'attestationId' | 'kind' | 'payloadHash'>> = {},
): { decision: DocumentDecision; ack?: AttestAck } {
  const parsed = AttestAckSchema.safeParse(raw);
  if (!parsed.success) return { decision: 'REJECTED_SCHEMA' };
  const { ackSignature, ...doc } = parsed.data;
  const key = commandKey(commandKeys, doc.kid, doc.ackedAt);
  if (!key) return { decision: 'REJECTED_KID' };
  if (!verifyDocument(ATTEST_ACK_DOMAIN, doc, ackSignature, key)) return { decision: 'REJECTED_SIGNATURE' };
  for (const field of ['nodeId', 'attestationId', 'kind', 'payloadHash'] as const) {
    if (expect[field] !== undefined && expect[field] !== doc[field]) return { decision: 'REJECTED_BINDING' };
  }
  return { decision: 'OK', ack: parsed.data };
}

export function signCpAuditRoot(doc: CpAuditRootDoc, privateKey: KeyObject): CpAuditRoot {
  const parsed = CpAuditRootDocSchema.parse(doc);
  return { ...parsed, sig: signDocument(CP_AUDIT_ROOT_DOMAIN, parsed, privateKey) };
}

/** Verifies a CP root against the command keys of the trust bundle. A node must not witness a root it cannot verify. */
export function verifyCpAuditRoot(raw: unknown, commandKeys: readonly CommandKeySlot[]): { decision: DocumentDecision; root?: CpAuditRoot } {
  const parsed = CpAuditRootSchema.safeParse(raw);
  if (!parsed.success) return { decision: 'REJECTED_SCHEMA' };
  const { sig, ...doc } = parsed.data;
  const key = commandKey(commandKeys, doc.kid, doc.publishedAt);
  if (!key) return { decision: 'REJECTED_KID' };
  if (!verifyDocument(CP_AUDIT_ROOT_DOMAIN, doc, sig, key)) return { decision: 'REJECTED_SIGNATURE' };
  return { decision: 'OK', root: parsed.data };
}

/**
 * How a candidate CP root relates to the newest one already held: `NEWER` is the only one to store, `SAME` an idempotent repeat, `OLDER` a
 * rollback (refused), `CONFLICT` two different roots published at the same instant (refused and worth an alert).
 */
export function compareCpRoot(candidate: Pick<CpAuditRoot, 'hash' | 'publishedAt'>, stored: Pick<CpAuditRoot, 'hash' | 'publishedAt'> | null): 'NEWER' | 'SAME' | 'OLDER' | 'CONFLICT' {
  if (!stored) return 'NEWER';
  if (candidate.publishedAt > stored.publishedAt) return 'NEWER';
  if (candidate.publishedAt < stored.publishedAt) return 'OLDER';
  return candidate.hash === stored.hash ? 'SAME' : 'CONFLICT';
}

// ── proofs and leaves on the wire ────────────────────────────────────────────

/** A leaf the control plane keeps for the roots it published, so a proof can be answered later. Strict and typed like the leaves of merkle.ts. */
export const MerkleLeafSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AUDIT_HEAD'), tenantId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/), headHash: sha256, rowCount: bigCount }).strict(),
  z.object({ type: z.literal('NODE_ROOT'), nodeId, merkleRoot: sha256, periodEnd: bigCount }).strict(),
]);

/** An inclusion proof as it travels (G: indexes and hashes). `verifyInclusionProof` of merkle.ts is the verifier. */
export const InclusionProofSchema = z.object({
  leafHash: sha256,
  index: count,
  size: z.number().int().min(1).max(2 ** 31 - 1),
  path: z.array(sha256).max(32),
  root: sha256,
}).strict();
