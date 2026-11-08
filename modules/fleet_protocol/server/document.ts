import { sign, verify, type KeyObject } from 'node:crypto';
import { canonicalBytes } from './canonical';
import { decodeCanonicalSig } from './sign';

/**
 * Domain-separated signing of any canonical-JSON document (licenses, leases, ...).
 *
 * The fleet envelope (`sign.ts`) is a closed message format. A document that is not a fleet message must not
 * be signed as one, and must not be verifiable as one. The signed bytes here are
 * `"fleet-doc-v1" 0x00 <domain> 0x00 <canonical JSON>`, so a signature made for one domain never verifies in
 * another domain, nor as an envelope signature (whose bytes start with `{`).
 *
 * Same Ed25519 keys, same canonical JSON (integers only), same strict signature decoding as the envelope.
 */
const PREFIX = 'fleet-doc-v1';
const DOMAIN_RE = /^[a-z][a-z0-9._-]{2,63}$/;

export class DocumentDomainError extends Error {}

function signedBytes(domain: string, doc: unknown): Buffer {
  if (!DOMAIN_RE.test(domain)) throw new DocumentDomainError(`invalid document domain "${domain}"`);
  return Buffer.concat([Buffer.from(`${PREFIX}\0${domain}\0`, 'utf8'), canonicalBytes(doc)]);
}

/**
 * The exact bytes `signDocument` signs, for signers that hold the key elsewhere (hardware token, external signer command):
 * they sign these bytes with plain Ed25519 and hand back the base64url signature.
 */
export const documentSigningBytes = signedBytes;

/** Signs `doc` for `domain`; returns the 86-char base64url signature. */
export function signDocument(domain: string, doc: unknown, privateKey: KeyObject): string {
  return sign(null, signedBytes(domain, doc), privateKey).toString('base64url');
}

/** True only for the canonical encoding of a valid signature over exactly this document and domain. */
export function verifyDocument(domain: string, doc: unknown, signature: string, publicKey: KeyObject): boolean {
  try {
    const sig = decodeCanonicalSig(signature);
    if (!sig) return false;
    return verify(null, signedBytes(domain, doc), publicKey, sig);
  } catch {
    return false;
  }
}
