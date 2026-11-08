import { z } from 'zod';
import { AttestAckSchema, AuditChainRootPayloadSchema, attestPayloadHash, verifyAttestAck, type AttestAck, type AuditChainRootPayload, type CommandKeySlot } from './attest.schema';
import { proveLeaf, verifyLeafProof, type AuditHeadLeaf } from './merkle';

/**
 * The proof that one tenant's audit chain head was acknowledged by the control plane (docs/phases/02-fleet/05 section 6.4 "Audit chain", 08 section
 * 7 `audit.chain_proof`): the tenant's `AUDIT_HEAD` leaf, its inclusion path in the Merkle root of an `AUDIT_CHAIN_ROOT` attestation of the node
 * that holds the chain, that attestation's payload, and the control plane's signed acknowledgement of it. Self-contained: whoever holds the control
 * plane's command keys (every node, in its trust bundle) can verify it without asking anyone; a migration target uses it to accept the history it
 * imports. Only G data: ids, hashes and counts.
 */
export const AUDIT_PROOF_VERSION = 1;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const AuditChainProofSchema = z.object({
  v: z.literal(AUDIT_PROOF_VERSION),
  /** The acknowledged head: the hash of the chain's row number `rowCount` (rows ever written, checkpointed ones included). */
  leaf: z.object({ tenantId: z.uuid(), headHash: sha256, rowCount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict(),
  inclusion: z.object({ leafHash: sha256, index: z.number().int().min(0), size: z.number().int().min(1), path: z.array(sha256).max(64), root: sha256 }).strict(),
  /** The attestation the root belongs to: its id and its payload (the ack signs the payload's hash). */
  attestationId: z.uuid(),
  payload: z.unknown(),
  ack: AttestAckSchema,
}).strict();
export type AuditChainProof = z.infer<typeof AuditChainProofSchema>;

/** Builds the proof from what the node keeps: the attestation's payload and leaves (`fleet_attestation_leaves`) and its stored ack. Null when the tenant is not a leaf. */
export function buildAuditChainProof(input: {
  tenantId: string; attestationId: string; payload: AuditChainRootPayload; leaves: readonly Omit<AuditHeadLeaf, 'type'>[]; ack: AttestAck;
}): AuditChainProof | null {
  const leaves: AuditHeadLeaf[] = input.leaves.map((l) => ({ type: 'AUDIT_HEAD', tenantId: l.tenantId, headHash: l.headHash, rowCount: l.rowCount }));
  const mine = leaves.find((l) => l.tenantId === input.tenantId);
  if (!mine || mine.rowCount < 1) return null;
  const inclusion = proveLeaf(leaves, mine);
  if (!inclusion) return null;
  return { v: AUDIT_PROOF_VERSION, leaf: { tenantId: mine.tenantId, headHash: mine.headHash, rowCount: mine.rowCount }, inclusion, attestationId: input.attestationId, payload: input.payload, ack: input.ack };
}

export type AuditProofRefusal =
  | 'SCHEMA' | 'WRONG_TENANT' | 'PAYLOAD' | 'ACK_SCHEMA' | 'ACK_KID' | 'ACK_SIGNATURE' | 'ACK_BINDING' | 'NOT_A_CHAIN_ROOT' | 'ROOT_MISMATCH' | 'INCLUSION';

export type AuditProofVerdict =
  | { ok: true; headHash: string; rowCount: number; ackedAt: string; attestationId: string }
  | { ok: false; reason: AuditProofRefusal };

/**
 * Verifies a proof for `tenantId` attested by `sourceNodeId`, against the control plane's command keys. Every link is checked: the leaf is this
 * tenant's, the payload is an audit chain root and hashes to what the ack signed, the ack verifies and names this node, this attestation and kind,
 * the inclusion path leads to the payload's root, and the tree it describes has exactly as many leaves as the root was attested with. Never throws.
 */
export function verifyAuditChainProof(raw: unknown, expect: { tenantId: string; sourceNodeId: string }, commandKeys: readonly CommandKeySlot[]): AuditProofVerdict {
  const parsed = AuditChainProofSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'SCHEMA' };
  const p = parsed.data;
  if (p.leaf.tenantId !== expect.tenantId) return { ok: false, reason: 'WRONG_TENANT' };
  const payload = AuditChainRootPayloadSchema.safeParse(p.payload);
  if (!payload.success) return { ok: false, reason: 'PAYLOAD' };
  let payloadHash: string;
  try { payloadHash = attestPayloadHash(payload.data); } catch { return { ok: false, reason: 'PAYLOAD' }; }
  const ack = verifyAttestAck(p.ack, commandKeys, { nodeId: expect.sourceNodeId, attestationId: p.attestationId, payloadHash });
  if (ack.decision !== 'OK') {
    return { ok: false, reason: ack.decision === 'REJECTED_SCHEMA' ? 'ACK_SCHEMA' : ack.decision === 'REJECTED_KID' ? 'ACK_KID' : ack.decision === 'REJECTED_SIGNATURE' ? 'ACK_SIGNATURE' : 'ACK_BINDING' };
  }
  if (p.ack.kind !== 'AUDIT_CHAIN_ROOT') return { ok: false, reason: 'NOT_A_CHAIN_ROOT' };
  if (p.inclusion.root !== payload.data.merkleRoot || p.inclusion.size !== payload.data.tenantChainCount) return { ok: false, reason: 'ROOT_MISMATCH' };
  if (!verifyLeafProof({ type: 'AUDIT_HEAD', ...p.leaf }, p.inclusion)) return { ok: false, reason: 'INCLUSION' };
  return { ok: true, headHash: p.leaf.headHash, rowCount: p.leaf.rowCount, ackedAt: p.ack.ackedAt, attestationId: p.attestationId };
}
