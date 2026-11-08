import { createPublicKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto'

/**
 * The compact JWS of Fleet ID (12-fleet-identity.md), shared by both ends so they apply one rule set: the provider on the fleet instance signs ID,
 * access and logout tokens and verifies the nodes' `private_key_jwt` client assertions and its own ID tokens as `id_token_hint`; a node's relying
 * party signs its client assertions with its dedicated RP key (F12) and verifies the ID and logout tokens. Moved here from `auth_oidc_provider`
 * (FID-07), which re-exports it. Deliberately small and strict instead of a general JOSE library:
 *  - two algorithms only, each bound to one key type: ES256 (EC P-256, signatures in the JWS r||s form) and EdDSA (Ed25519). `none`, HMAC and RSA
 *    are never accepted, and the verifier takes the algorithm from the KEY, never from the token header (no algorithm confusion).
 *  - a header that names a key by reference or carries one (`jku`, `jwk`, `x5u`, `x5c`) or marks a critical extension (`crit`) is refused: the only
 *    key that verifies a token is the one the caller hands in.
 *  - three base64url segments, no padding, at most 16 KiB, and a JSON object header and payload.
 */
export type JwsAlg = 'ES256' | 'EdDSA'
export const MAX_JWS_BYTES = 16 * 1024
const SEGMENT = /^[A-Za-z0-9_-]+$/
const FORBIDDEN_HEADER_MEMBERS = ['jku', 'jwk', 'x5u', 'x5c', 'crit'] as const

export const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url')

/** The algorithm a key signs with, or null for any other key (RSA, P-384, X25519, a secret). */
export function algForKey(key: KeyObject): JwsAlg | null {
  if (key.asymmetricKeyType === 'ed25519') return 'EdDSA'
  if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return 'ES256'
  return null
}

/**
 * Something that signs for one key without handing the key out: a KMS key (the provider's signing key, F15) or a local key in tests and on a
 * development fleet instance. The signature is in JWS form (ES256: r||s, 64 bytes; EdDSA: 64 bytes).
 */
export interface JwsSigner { kid: string; alg: JwsAlg; publicKey: KeyObject; sign(data: Buffer): Promise<Buffer> }

const rawSign = (alg: JwsAlg, data: Buffer, privateKey: KeyObject): Buffer =>
  alg === 'EdDSA' ? cryptoSign(null, data, privateKey) : cryptoSign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' })

/** A signer over a private key held in this process. */
export function localSigner(kid: string, privateKey: KeyObject): JwsSigner {
  const alg = algForKey(privateKey)
  if (!alg || privateKey.type !== 'private') throw new Error('jws: the signing key must be a private EC P-256 or Ed25519 key')
  return { kid, alg, publicKey: createPublicKey(privateKey), sign: async (data) => rawSign(alg, data, privateKey) }
}

const signingInput = (alg: JwsAlg, kid: string, typ: string, payload: Record<string, unknown>): string =>
  `${b64u(JSON.stringify({ alg, kid, typ }))}.${b64u(JSON.stringify(payload))}`

/** Signs with a key held in this process (client assertions in tests, the local signer). */
export function signJws(header: { kid: string; typ: string }, payload: Record<string, unknown>, privateKey: KeyObject): string {
  const alg = algForKey(privateKey)
  if (!alg || privateKey.type !== 'private') throw new Error('jws: the signing key must be a private EC P-256 or Ed25519 key')
  const input = signingInput(alg, header.kid, header.typ, payload)
  return `${input}.${b64u(rawSign(alg, Buffer.from(input), privateKey))}`
}

/** Signs through a signer (the KMS path). The signature length is checked, so a signer that answers DER or garbage fails here, not at a node. */
export async function signJwsWith(signer: JwsSigner, typ: string, payload: Record<string, unknown>): Promise<string> {
  const input = signingInput(signer.alg, signer.kid, typ, payload)
  const sig = await signer.sign(Buffer.from(input))
  if (sig.length !== 64) throw new Error('jws: the signer returned a signature of the wrong length')
  return `${input}.${b64u(sig)}`
}

export interface DecodedJws { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer }

const parseObject = (seg: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Splits and parses a compact JWS without verifying it (to read `kid` and `iss` before choosing the key). Null for anything malformed. */
export function decodeJws(token: unknown): DecodedJws | null {
  if (typeof token !== 'string' || token.length > MAX_JWS_BYTES) return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return null
  const header = parseObject(parts[0])
  const payload = parseObject(parts[1])
  if (!header || !payload) return null
  if (FORBIDDEN_HEADER_MEMBERS.some((m) => Object.prototype.hasOwnProperty.call(header, m))) return null
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') }
}

/** Verifies `token` with `publicKey`. The header's `alg` must be the key's algorithm; `typ`, when given, must match exactly. */
export function verifyJws(token: unknown, publicKey: KeyObject, opts: { typ?: string } = {}): DecodedJws | null {
  const d = decodeJws(token)
  if (!d) return null
  const alg = algForKey(publicKey)
  if (!alg || d.header.alg !== alg) return null
  if (opts.typ !== undefined && d.header.typ !== opts.typ) return null
  const key = publicKey.type === 'private' ? createPublicKey(publicKey) : publicKey
  if (d.signature.length !== 64) return null
  const ok = alg === 'EdDSA'
    ? cryptoVerify(null, Buffer.from(d.signingInput), key, d.signature)
    : cryptoVerify('sha256', Buffer.from(d.signingInput), { key, dsaEncoding: 'ieee-p1363' }, d.signature)
  return ok ? d : null
}

/** A public key from a registered public JWK (EC P-256 or OKP Ed25519 only), or null. */
export function publicKeyFromJwk(jwk: Record<string, unknown>): KeyObject | null {
  if (!jwk || typeof jwk !== 'object') return null
  const isEc = jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string'
  const isOkp = jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && typeof jwk.x === 'string'
  if (!isEc && !isOkp) return null
  try {
    const key = createPublicKey({ key: (isEc ? { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } : { kty: 'OKP', crv: 'Ed25519', x: jwk.x }) as import('node:crypto').JsonWebKey, format: 'jwk' })
    return algForKey(key) ? key : null
  } catch {
    return null
  }
}
