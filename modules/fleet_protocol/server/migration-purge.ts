import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { LifecycleEventBodySchema, verifyLifecycleReceipt } from './lifecycle-receipt';

/**
 * The purge of a migrated tenant's SOURCE copy (docs/phases/02-fleet/05 section 6.2 COMPLETED): once the source retention ends (Decision 22), a SEPARATE
 * class-3 `tenant.purge` with its own approvals goes to the former home, and "it also requires the target's signed MIGRATION_IMPORTED receipt" (02 section 4).
 * The command then carries three more fields than a deletion purge:
 *
 *   - `migrationId`: the move whose source copy goes (the source's own record of that export, `fleet_migration_bundles`, is what it purges against);
 *   - `importReceipt`: the target's signed receipt of the import, exactly as the target signed it (the control plane relays it, it cannot forge it);
 *   - `targetSigningPublicKey`: the target's signing key, raw. The SOURCE trusts it only when it hashes to the target fingerprint it pinned from the
 *     co-signed contract at the export, never on the control plane's word.
 *
 * All three or none: a `tenant.purge` without them is the deletion purge of a tenant awaiting deletion (05 section 7 stage 9).
 */
const rawEd25519 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const SOURCE_PURGE_FIELDS = ['migrationId', 'importReceipt', 'targetSigningPublicKey'] as const;

export const SourcePurgeProofSchema = z.object({
  tenantId: z.uuid(),
  migrationId: z.uuid(),
  importReceipt: LifecycleEventBodySchema,
  targetSigningPublicKey: rawEd25519,
}).passthrough();
export type SourcePurgeProof = z.infer<typeof SourcePurgeProofSchema>;

/** The optional fields `tenant.purge` takes for a source purge (the catalogue's schema spreads them and requires all three or none). */
export const SOURCE_PURGE_OPTIONAL = {
  migrationId: z.uuid().optional(),
  importReceipt: LifecycleEventBodySchema.optional(),
  targetSigningPublicKey: rawEd25519.optional(),
};

/** All three source-purge fields, or none of them. */
export function sourcePurgeFieldsConsistent(p: Record<string, unknown>): boolean {
  const n = SOURCE_PURGE_FIELDS.filter((k) => p[k] !== undefined).length;
  return n === 0 || n === SOURCE_PURGE_FIELDS.length;
}

/** Whether a `tenant.purge` payload is a source purge (it names a migration). */
export const isSourcePurge = (p: unknown): boolean => typeof p === 'object' && p !== null && (p as Record<string, unknown>).migrationId !== undefined;

/** sha256 (hex) of an Ed25519 key's SPKI DER: the node fingerprint the control plane enrols and a migration contract names. */
export function signingKeyFingerprint(key: KeyObject): string {
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

/** What the SOURCE knows of the export it is asked to purge (its bundle record): nothing here comes from the command. */
export interface SourcePurgeFacts {
  tenantId: string;
  migrationId: string;
  targetNodeId: string;
  /** The contract's target fingerprint, pinned at the export; null on a record written before the pin existed. */
  targetFingerprint: string | null;
  /** The sha256 of the sealed bundle this node exported. */
  sealedSha256: string | null;
}

export type SourcePurgeVerdict = 'OK' | 'BAD_SHAPE' | 'WRONG_CONTRACT' | 'NO_TARGET_PIN' | 'WRONG_TARGET_KEY' | 'BAD_RECEIPT' | 'WRONG_RECEIPT';

/**
 * The source's check of the proof a source purge carries: the payload names this export (migration and tenant), the key hashes to the fingerprint the
 * source pinned at the export, the receipt is signed by that key, and it is the TARGET's MIGRATION_IMPORTED receipt of this tenant naming the very sealed
 * bundle this node exported. Anything else and nothing is purged: the target never confirmed it holds the tenant.
 */
export function verifySourcePurgeProof(payload: unknown, facts: SourcePurgeFacts): SourcePurgeVerdict {
  const p = SourcePurgeProofSchema.safeParse(payload);
  if (!p.success) return 'BAD_SHAPE';
  if (p.data.migrationId !== facts.migrationId || p.data.tenantId !== facts.tenantId) return 'WRONG_CONTRACT';
  if (!facts.targetFingerprint || !facts.sealedSha256) return 'NO_TARGET_PIN';
  let key: KeyObject;
  try { key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: p.data.targetSigningPublicKey }, format: 'jwk' }); } catch { return 'WRONG_TARGET_KEY'; }
  if (signingKeyFingerprint(key) !== facts.targetFingerprint) return 'WRONG_TARGET_KEY';
  if (!verifyLifecycleReceipt(p.data.importReceipt, key)) return 'BAD_RECEIPT';
  const r = p.data.importReceipt.receipt;
  if (r.type !== 'MIGRATION_IMPORTED' || r.nodeId !== facts.targetNodeId || r.tenantId !== facts.tenantId || r.payload.hashes?.SEALED_BUNDLE !== facts.sealedSha256) return 'WRONG_RECEIPT';
  return 'OK';
}
