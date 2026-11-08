import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { boundCosignText, commandBodyText, type CosignBinding } from './cosign-challenge';

/**
 * Operator co-signing for class-3 commands (docs/phases/02-fleet/03 §2 rule 7, 04 §4.2). Each approver signs the command with a WebAuthn
 * credential whose challenge is the BOUND challenge of decision F88 (`boundCosignChallenge`): sha256 over the canonical
 * `{ d: 'fleet.cosign.v2', jti, aud, exp, body: commandHash(body) }`, i.e. this command body, this command id (the envelope's `jti`), this node
 * (`aud`, `node:<nodeId>`) and this window (`exp`). The node recomputes it from the envelope it received and verifies each assertion OFFLINE
 * against the credential's public key from the trust bundle's `operatorCosignKeys` (id = credential id, publicKey = SPKI DER, base64url), so stored
 * approvals cannot be replayed to another node, as a new command id or with a later expiry (fleet audit FA-1; 04 §4.2(3), §8.3). A tenant migration
 * step is the one exception: it carries the approvals of its migration CONTRACT, which binds the migration, the tenant, both nodes, the target's
 * fingerprint and an expiry itself (`approvalChallengeFor` in `migration-step.ts`). Only what `node:crypto` can verify synchronously is supported
 * (ES256 / P-256 and Ed25519): no WebAuthn library, no network.
 * Requirements checked: assertion type `webauthn.get`, challenge == the expected hex, origin in the bundle's allowed origins,
 * rpIdHash == sha256(rpId), user presence AND user verification flags, valid signature over authData || sha256(clientDataJSON).
 * The signature counter is NOT checked here (the node has no durable per-credential state yet); the node's ledger accepts one jti once.
 * The texts that are hashed live in `cosign-challenge.ts` (no `node:crypto`), which the fleet console hashes with WebCrypto.
 */
const b64u = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);

export const CosignAssertionSchema = z.object({ clientDataJSON: b64u, authenticatorData: b64u, signature: b64u }).strict();
export type CosignAssertion = z.infer<typeof CosignAssertionSchema>;

export const ApprovalSchema = z.object({ userId: z.string().min(1).max(128), credentialId: b64u, assertion: CosignAssertionSchema }).strict();
export type Approval = z.infer<typeof ApprovalSchema>;

export const CosignRpSchema = z.object({ rpId: z.string().min(1).max(253), origins: z.array(z.url()).min(1).max(8) }).strict();
export type CosignRp = z.infer<typeof CosignRpSchema>;

/**
 * sha256 (hex) of the canonical command body WITHOUT `approvals`: the control plane's `envelopeHash` (idempotency, display) and the `body` member of
 * the bound challenge. Not, on its own, what an approver signs any more (decision F88).
 */
export function commandHash(body: Record<string, unknown>): string {
  return createHash('sha256').update(commandBodyText(body)).digest('hex');
}

/**
 * What every approver of a class-3 command signs (decision F88): sha256 (hex) of the canonical `{ d: 'fleet.cosign.v2', jti, aud, exp,
 * body: commandHash(body) }`. `jti` is compared in lower case; `exp` is the envelope's expiry in Unix seconds (the control plane's
 * `Math.floor(expiresAt.getTime() / 1000)`). Throws on a non-integer `exp` (canonical JSON allows integers only).
 */
export function boundCosignChallenge(i: CosignBinding & { body: Record<string, unknown> }): string {
  return createHash('sha256').update(boundCosignText({ jti: i.jti, aud: i.aud, exp: i.exp, bodyHash: commandHash(i.body) })).digest('hex');
}

export type CosignFailure =
  | 'BAD_ENCODING' | 'BAD_TYPE' | 'BAD_CHALLENGE' | 'BAD_ORIGIN' | 'BAD_RP' | 'NO_USER_PRESENCE' | 'NO_USER_VERIFICATION' | 'BAD_KEY' | 'BAD_SIGNATURE';

const dec = (s: string) => Buffer.from(s, 'base64url');

export function verifyCosignAssertion(i: { assertion: CosignAssertion; challengeHex: string; rp: CosignRp; publicKeySpki: string }): { ok: true } | { ok: false; reason: CosignFailure } {
  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  const clientBytes = dec(i.assertion.clientDataJSON); const authData = dec(i.assertion.authenticatorData); const sig = dec(i.assertion.signature);
  try { clientData = JSON.parse(clientBytes.toString('utf8')); } catch { return { ok: false, reason: 'BAD_ENCODING' }; }
  // JSON.parse also returns primitives and null; reading a field of null would throw instead of giving a verdict.
  if (typeof clientData !== 'object' || clientData === null) return { ok: false, reason: 'BAD_ENCODING' };
  if (authData.length < 37 || !/^[0-9a-f]{64}$/.test(i.challengeHex)) return { ok: false, reason: 'BAD_ENCODING' };
  if (clientData.type !== 'webauthn.get') return { ok: false, reason: 'BAD_TYPE' };
  if (clientData.challenge !== Buffer.from(i.challengeHex, 'hex').toString('base64url')) return { ok: false, reason: 'BAD_CHALLENGE' };
  if (typeof clientData.origin !== 'string' || !i.rp.origins.includes(clientData.origin) || clientData.crossOrigin === true) return { ok: false, reason: 'BAD_ORIGIN' };
  if (!authData.subarray(0, 32).equals(createHash('sha256').update(i.rp.rpId).digest())) return { ok: false, reason: 'BAD_RP' };
  const flags = authData[32];
  if (!(flags & 0x01)) return { ok: false, reason: 'NO_USER_PRESENCE' };
  if (!(flags & 0x04)) return { ok: false, reason: 'NO_USER_VERIFICATION' };

  let key: KeyObject;
  try { key = createPublicKey({ key: dec(i.publicKeySpki), format: 'der', type: 'spki' }); } catch { return { ok: false, reason: 'BAD_KEY' }; }
  const signed = Buffer.concat([authData, createHash('sha256').update(clientBytes).digest()]);
  try {
    if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return verify('sha256', signed, key, sig) ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
    if (key.asymmetricKeyType === 'ed25519') return verify(null, signed, key, sig) ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
  } catch { return { ok: false, reason: 'BAD_SIGNATURE' }; }
  return { ok: false, reason: 'BAD_KEY' };
}
