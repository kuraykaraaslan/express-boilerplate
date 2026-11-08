// Supply-chain checks for a plugin bundle (roadmap: checksum, publisher signature, SBOM).
//
//  - Integrity: SHA-256 of the stored bytes, computed by the SERVER at upload. A publisher may also
//    declare the checksum they built; a mismatch refuses the submission. At install and at load
//    the stored bundle is re-hashed and compared, so a swapped or corrupted object in storage is
//    caught before it runs.
//  - Authenticity: an Ed25519 signature over the digest, verified against the key the publisher
//    registered while authenticated (never a key that arrives inside the submission).
//  - SBOM: a CycloneDX or SPDX JSON document, size-capped and stored verbatim for the reviewer.
//
// Pure + node:crypto only. Core since OD-139 (docs/phases/35-editions-licensing): the marketplace and
// the operator's local plugin store (plugin_local) share it; marketplace_developer/server/bundle-integrity
// re-exports it from its old path.

import { createHash, createPublicKey, verify } from 'node:crypto';

export const MAX_SBOM_BYTES = 500_000;
export const MAX_BUNDLE_BYTES = 5_000_000;

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const SHA256_HEX = /^[a-f0-9]{64}$/i;

/** A declared checksum must be 64 hex chars; anything else is a typo, not a mismatch. */
export function normalizeChecksum(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/^sha256[:\-]/, '');
  if (!SHA256_HEX.test(v)) throw new Error('bundleSha256 must be a 64-character hex SHA-256.');
  return v;
}

/** Refuse a submission whose declared checksum is not what the server stored. */
export function assertDeclaredChecksum(declared: string | undefined, actual: string): void {
  if (declared === undefined || declared === '') return;
  if (normalizeChecksum(declared) !== actual) {
    throw new Error('The bundle checksum does not match: the uploaded file is not the one you built (expected sha256 ' + normalizeChecksum(declared) + ', got ' + actual + ').');
  }
}

/** Validate an Ed25519 SPKI public key (base64 DER) and return it normalised. */
export function validateSigningPublicKey(spkiBase64: string): string {
  const b64 = spkiBase64.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  try {
    const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    return b64;
  } catch {
    throw new Error('The signing key must be an Ed25519 public key (SPKI, base64 or PEM).');
  }
}

/** Does `signatureBase64` sign the bundle's SHA-256 digest bytes under this key? Never throws. */
export function verifyBundleSignature(publicKeySpkiBase64: string, sha256: string, signatureBase64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiBase64, 'base64'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(sha256, 'hex'), key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/** A well-formed SBOM, or an error. Returned verbatim (re-serialised compactly) for storage. */
export function parseSbom(raw: string): { format: 'CycloneDX' | 'SPDX'; json: string; components: number } {
  if (Buffer.byteLength(raw, 'utf8') > MAX_SBOM_BYTES) throw new Error(`The SBOM is too large (max ${MAX_SBOM_BYTES / 1000} KB).`);
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error('The SBOM must be valid JSON.'); }
  if (doc && typeof doc === 'object' && doc.bomFormat === 'CycloneDX') {
    return { format: 'CycloneDX', json: JSON.stringify(doc), components: Array.isArray(doc.components) ? doc.components.length : 0 };
  }
  if (doc && typeof doc === 'object' && typeof doc.spdxVersion === 'string') {
    return { format: 'SPDX', json: JSON.stringify(doc), components: Array.isArray(doc.packages) ? doc.packages.length : 0 };
  }
  throw new Error('The SBOM must be a CycloneDX (bomFormat) or SPDX (spdxVersion) JSON document.');
}

/** At install/load: the stored bundle must still hash to what was recorded. Versions from before checksums carry none and pass. */
export function assertBundleMatches(recorded: string | null | undefined, code: string | Buffer): void {
  if (!recorded) return;
  if (sha256Hex(code) !== recorded.toLowerCase()) {
    throw new Error('The stored plugin bundle no longer matches its recorded checksum and was not run.');
  }
}
