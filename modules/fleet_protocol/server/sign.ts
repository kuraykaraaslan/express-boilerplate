import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalBytes } from './canonical';
import { EnvelopeSchema, SIGNED_FIELDS, type Envelope, type UnsignedEnvelope } from './envelope.schema';

export function generateSigningKeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519');
}

/** Raw 32-byte Ed25519 public key as base64url (the form trust bundles carry). */
export function exportPublicKey(key: KeyObject): string {
  return ((key.type === 'public' ? key : createPublicKey(key)).export({ format: 'jwk' }) as { x: string }).x;
}

export function importPublicKey(rawBase64url: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: rawBase64url }, format: 'jwk' });
}

export function importPrivateKeyPem(pem: string): KeyObject {
  return createPrivateKey(pem);
}

function signedView(e: UnsignedEnvelope | Envelope): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const f of SIGNED_FIELDS) if (e[f] !== undefined) view[f] = e[f];
  return view;
}

export function signEnvelope(unsigned: UnsignedEnvelope, privateKey: KeyObject): Envelope {
  const sig = sign(null, canonicalBytes(signedView(unsigned)), privateKey).toString('base64url');
  return { ...unsigned, sig };
}

/** Strict base64url: only the canonical encoding of a 64-byte Ed25519 signature (no padding, no stray bits, no junk chars). */
export function decodeCanonicalSig(sig: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{86}$/.test(sig)) return null;
  const raw = Buffer.from(sig, 'base64url');
  return raw.length === 64 && raw.toString('base64url') === sig ? raw : null;
}

export function verifySignature(envelope: Envelope, publicKey: KeyObject): boolean {
  try {
    const sig = decodeCanonicalSig(envelope.sig);
    if (!sig) return false;
    return verify(null, canonicalBytes(signedView(envelope)), publicKey, sig);
  } catch {
    return false;
  }
}

export type VerifyDecision =
  | 'REJECTED_SCHEMA'
  | 'REJECTED_AUD'
  | 'REJECTED_KID'
  | 'REJECTED_ISSUER'
  | 'REJECTED_SIGNATURE'
  | 'NOT_YET_VALID'
  | 'EXPIRED';

export interface TrustedKey {
  publicKey: KeyObject;
  revoked?: boolean;
  /** Issuers this key may speak for (a `cmd` key must be the fleet's). Omit to allow any. */
  issuers?: readonly string[];
}

export interface VerifyContext {
  /** Receiver identity, e.g. `node:abc` or `cp`. */
  self: string;
  /** Current and previous trust bundle keys by kid. */
  keys: ReadonlyMap<string, TrustedKey>;
  /** Unix seconds. */
  now: number;
  /** Clock-skew allowance for `nbf` (03 §2 rule 5). */
  skewSeconds?: number;
  /** Upper bound for exp - iat, e.g. the command kind's maxTtl. */
  maxTtlSeconds?: number;
}

export type VerifyResult = { ok: true; envelope: Envelope } | { ok: false; decision: VerifyDecision };

/** Rules 1-5 of 03 §2, in order. Rules 6-8 (replay ledger, catalogue, policy) belong to the agent. */
export function verifyEnvelope(raw: unknown, ctx: VerifyContext): VerifyResult {
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, decision: 'REJECTED_SCHEMA' };
  const env = parsed.data;
  try {
    canonicalBytes(signedView(env));
  } catch {
    return { ok: false, decision: 'REJECTED_SCHEMA' };
  }
  if (env.aud !== ctx.self) return { ok: false, decision: 'REJECTED_AUD' };

  const key = ctx.keys.get(env.kid);
  if (!key || key.revoked) return { ok: false, decision: 'REJECTED_KID' };
  if (env.typ === 'cmd' && env.iss !== 'fleet') return { ok: false, decision: 'REJECTED_ISSUER' };
  if (key.issuers && !key.issuers.includes(env.iss)) return { ok: false, decision: 'REJECTED_ISSUER' };

  if (!verifySignature(env, key.publicKey)) return { ok: false, decision: 'REJECTED_SIGNATURE' };

  const skew = ctx.skewSeconds ?? 60;
  if (env.nbf > ctx.now + skew) return { ok: false, decision: 'NOT_YET_VALID' };
  if (env.exp <= ctx.now) return { ok: false, decision: 'EXPIRED' };
  if (ctx.maxTtlSeconds !== undefined && env.exp - env.iat > ctx.maxTtlSeconds) {
    return { ok: false, decision: 'REJECTED_SCHEMA' };
  }
  return { ok: true, envelope: env };
}
