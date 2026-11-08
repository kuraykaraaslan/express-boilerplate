import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'

/**
 * Request signing and enrolment secrets for probe runners (observability phase 10.2). Pure crypto, no I/O.
 *
 * A runner holds an Ed25519 private key that never leaves its host; the control plane stores only the PUBLIC key, so a database leak cannot
 * be used to impersonate a runner. Every runner request is signed over its method, path, timestamp, nonce and body hash. The timestamp bounds how long a
 * captured request is useful; what it cannot bound (a result replayed inside the window) is closed by lease state, not by this module.
 */

export const MAX_CLOCK_SKEW_MS = 5 * 60_000
export const ENROLMENT_TOKEN_PREFIX = 'pe_'

export function generateRunnerKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  }
}

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

/** A short, comparable identity for a public key (shown to the tenant at enrolment so they can check the runner is the one they started). */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer
  return sha256Hex(der).slice(0, 32).replace(/(.{4})/g, '$1:').slice(0, -1)
}

export interface SignedParts { method: string; path: string; timestamp: number; nonce: string; bodySha256: string }

export function canonicalRequest(p: SignedParts): string {
  return [p.method.toUpperCase(), p.path, String(p.timestamp), p.nonce, p.bodySha256].join('\n')
}

export function signRequest(privateKeyPem: string, parts: SignedParts): string {
  return sign(null, Buffer.from(canonicalRequest(parts)), createPrivateKey(privateKeyPem)).toString('base64url')
}

/** False for any malformed key or signature: verification never throws. */
export function verifyRequest(publicKeyPem: string, parts: SignedParts, signature: string): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(signature)) return false
    return verify(null, Buffer.from(canonicalRequest(parts)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))
  } catch { return false }
}

export function withinSkew(timestampMs: number, now: Date, maxMs = MAX_CLOCK_SKEW_MS): boolean {
  return Number.isFinite(timestampMs) && Math.abs(now.getTime() - timestampMs) <= maxMs
}

export function generateEnrolmentToken(): string { return ENROLMENT_TOKEN_PREFIX + randomBytes(24).toString('base64url') }
export const hashEnrolmentToken = (token: string): string => sha256Hex(token)
export const looksLikeEnrolmentToken = (t: string): boolean => /^pe_[A-Za-z0-9_-]{32}$/.test(t)
export const generateNonce = (): string => randomBytes(12).toString('base64url')
