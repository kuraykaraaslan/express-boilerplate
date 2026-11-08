import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalBytes } from './canonical';
import { signDocument, verifyDocument } from './document';
import { MigrationContractSchema, type MigrationContract } from './contract.schema';
import { boundCosignChallenge } from './cosign';
import { SealedNamesSchema } from './migration-names';

/**
 * The step commands of a tenant migration (docs/phases/02-fleet/05 sections 6.1 and 6.2).
 *
 * ONE APPROVAL SET FOR THE WHOLE MIGRATION. Two distinct operators co-sign the migration CONTRACT once (WebAuthn assertions over its hash); the fleet
 * instance then issues every step itself, each embedding the contract, its hash and those approvals. A node verifies the approvals against the
 * CONTRACT hash (`approvalChallengeFor`), not the command hash: that is what lets the directory drive the steps without a human per step, and it is
 * still safe, because every step names the exact contract the approvers saw and a node acts only within it (same ids, same target fingerprint,
 * inside `exp`). Any other class-3 command keeps its own approvals over its own bound challenge (`boundCosignChallenge`, decision F88).
 *
 * The target's KEY ATTESTATION (05 section 6.2 PREFLIGHT): the target generates an ephemeral X25519 key for the bundle and signs
 * `{migrationId, tenantId, sourceNodeId, targetNodeId, ephemeralPub, exp}` with its NODE_SIGN key; the control plane relays it opaquely to the source,
 * which verifies it against the target's signing key: the export carries that key, and the source accepts it only when it hashes to the contract's
 * co-signed `targetNodeFingerprint` (`targetSigningKeyFor`) and its own region pins that fingerprint, so a substituted key fails.
 *
 * The NAMES CHECK between the preflight and the export (05 section 6.2 NAMES, `migration-names.ts`): `tenant.migrate.seal_names` on the SOURCE seals the
 * tenant's slug and domains to the attested key (the same checks as the export, but nothing is frozen), the control plane relays the opaque box, and
 * `tenant.migrate.check_names` on the TARGET opens it and refuses a name it cannot take, so a collision is refused while the tenant is still writable.
 */
export const MIGRATION_STEP_KINDS = [
  'tenant.migrate.preflight', 'tenant.migrate.seal_names', 'tenant.migrate.check_names', 'tenant.migrate.export', 'tenant.migrate.import', 'tenant.migrate.cutover', 'tenant.migrate.abort', 'tenant.migrate.rollback',
] as const;
export type MigrationStepKind = (typeof MIGRATION_STEP_KINDS)[number];
export const isMigrationStepKind = (k: unknown): k is MigrationStepKind => typeof k === 'string' && (MIGRATION_STEP_KINDS as readonly string[]).includes(k);

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** An https origin (a node's public or peer address). */
const httpsBase = z.url({ protocol: /^https$/ }).max(255);
/** An Ed25519 public key, raw 32 bytes as base64url (the form trust bundles carry). */
const rawEd25519 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const reason = z.string().min(1).max(500);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** sha256 (hex) of the canonical contract: the challenge the operators co-sign and the value every step names. */
export function migrationContractHash(contract: MigrationContract): string {
  return createHash('sha256').update(canonicalBytes(contract)).digest('hex');
}

// ── the target's key attestation ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const MIGRATION_KEY_ATTESTATION_DOMAIN = 'fleet.migration-key';

export const MigrationKeyAttestationDocSchema = z.object({
  v: z.literal(1),
  migrationId: z.uuid(),
  tenantId: z.uuid(),
  sourceNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  targetNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** The ephemeral X25519 public key, raw 32 bytes as base64url. */
  ephemeralPub: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  exp: z.number().int().positive(),
}).strict();
export type MigrationKeyAttestationDoc = z.infer<typeof MigrationKeyAttestationDocSchema>;
export const MigrationKeyAttestationSchema = z.object({ doc: MigrationKeyAttestationDocSchema, sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
export type MigrationKeyAttestation = z.infer<typeof MigrationKeyAttestationSchema>;

export function signMigrationKeyAttestation(doc: MigrationKeyAttestationDoc, targetSigningKey: KeyObject): MigrationKeyAttestation {
  const d = MigrationKeyAttestationDocSchema.parse(doc);
  return { doc: d, sig: signDocument(MIGRATION_KEY_ATTESTATION_DOMAIN, d, targetSigningKey) };
}

/**
 * The source's check of the attestation it is handed: signed by the TARGET's signing key (from the source's trust bundle, never from the message),
 * about exactly this contract (migration, tenant, both nodes), and not expired at `nowSec` nor after the contract.
 */
export function verifyMigrationKeyAttestation(a: unknown, contract: MigrationContract, targetSigningKey: KeyObject, nowSec: number): 'OK' | 'BAD_SHAPE' | 'BAD_SIGNATURE' | 'WRONG_CONTRACT' | 'EXPIRED' {
  const p = MigrationKeyAttestationSchema.safeParse(a);
  if (!p.success) return 'BAD_SHAPE';
  if (!verifyDocument(MIGRATION_KEY_ATTESTATION_DOMAIN, p.data.doc, p.data.sig, targetSigningKey)) return 'BAD_SIGNATURE';
  const d = p.data.doc;
  if (d.migrationId !== contract.migrationId || d.tenantId !== contract.tenantId || d.sourceNodeId !== contract.sourceNodeId || d.targetNodeId !== contract.targetNodeId) return 'WRONG_CONTRACT';
  if (d.exp <= nowSec || d.exp > contract.exp) return 'EXPIRED';
  return 'OK';
}

/**
 * The source's check of the target key the export names (05 section 6.2 EXPORTING): the raw Ed25519 key hashes (sha256 of its SPKI DER, the fingerprint the
 * control plane enrolled) to the CONTRACT's `targetNodeFingerprint`, which two operators co-signed. The key travels with the step; the trust in it comes
 * from the contract (and from the source region's own pin of that fingerprint, its `allowedMigrationTargets`), never from the control plane's word.
 */
export function targetSigningKeyFor(contract: MigrationContract, rawPublicKey: string): KeyObject | null {
  let key: KeyObject;
  try { key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: rawPublicKey }, format: 'jwk' }); } catch { return null; }
  const fingerprint = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
  return fingerprint === contract.targetNodeFingerprint ? key : null;
}

// ── step payloads ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const carrier = { contract: MigrationContractSchema, contractHash: sha256 };
const bound = <T extends z.ZodType<{ contract: MigrationContract; contractHash: string }>>(s: T) =>
  s.refine((p) => migrationContractHash(p.contract) === p.contractHash, 'contractHash does not match the contract');

/** The payload of each step (the command body without `kind`, `class` and `approvals`): the contract itself, its hash, and what the step needs. */
export const MIGRATION_STEP_PAYLOADS = {
  'tenant.migrate.preflight': bound(z.object(carrier).strict()),
  /** The source seals the tenant's names to the attested key: the export's own checks of the target key and the attestation, without the freeze. */
  'tenant.migrate.seal_names': bound(z.object({ ...carrier, targetKeyAttestation: MigrationKeyAttestationSchema, targetSigningPublicKey: rawEd25519 }).strict()),
  /** The target opens the box the source sealed (relayed opaquely by the control plane) and checks the names against its own tenants. */
  'tenant.migrate.check_names': bound(z.object({ ...carrier, sealedNames: SealedNamesSchema }).strict()),
  'tenant.migrate.export': bound(z.object({ ...carrier, targetKeyAttestation: MigrationKeyAttestationSchema, targetSigningPublicKey: rawEd25519 }).strict()),
  'tenant.migrate.import': bound(z.object({ ...carrier, sealedBundleHash: sha256, expectedRows: count, expectedObjects: count, sourcePeerBaseUrl: httpsBase }).strict()),
  /**
   * Both sides: the target goes live at `assignmentVersion` in `homeRegionId` with the tenant's directory status (a suspended tenant stays suspended); the
   * source becomes a tombstone pointing at `relocatedToBaseUrl`.
   */
  'tenant.migrate.cutover': bound(z.object({
    ...carrier, relocatedToBaseUrl: httpsBase, homeRegionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), assignmentVersion: z.number().int().min(1).max(2 ** 31 - 1),
    tenantStatus: z.enum(['ACTIVE', 'SUSPENDED']),
  }).strict()),
  'tenant.migrate.abort': bound(z.object({ ...carrier, reason }).strict()),
  'tenant.migrate.rollback': bound(z.object({ ...carrier, reason }).strict()),
} as const satisfies Record<MigrationStepKind, z.ZodType>;

/**
 * The challenge the approvals of a class-3 command must have signed, from the envelope the node received: the CONTRACT hash for a migration step
 * whose contract hashes to its `contractHash` (one approval set for the whole migration; the contract binds the migration, the tenant, both nodes,
 * the target's fingerprint and its own `exp`), and the BOUND challenge (`boundCosignChallenge`, decision F88) for anything else: this body, the
 * envelope's own `jti`, `aud` and `exp`. A migration step whose contract does not hash to its `contractHash` gets the bound challenge, so the
 * contract's approvals can never be borrowed by a step that names a different contract. Throws on an `exp` canonical JSON cannot carry (callers
 * pass a schema-checked envelope, whose `exp` is an integer).
 */
export function approvalChallengeFor(env: { jti: string; aud: string; exp: number; body: Record<string, unknown> }): string {
  const body = env.body;
  if (isMigrationStepKind(body.kind)) {
    const c = MigrationContractSchema.safeParse(body.contract);
    if (c.success && typeof body.contractHash === 'string' && migrationContractHash(c.data) === body.contractHash) return body.contractHash;
  }
  return boundCosignChallenge({ jti: env.jti, aud: env.aud, exp: env.exp, body });
}
