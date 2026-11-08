import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

/**
 * Sealed box for PII-capable payload fields (03 §2 rule 7): anonymous sender, only the recipient
 * can open. Construction: ephemeral X25519 -> HKDF-SHA256(salt = epk || recipient pk) -> AES-256-GCM,
 * wire = base64url(epk[32] || nonce[12] || ciphertext || tag[16]). This is the libsodium *shape*
 * built on Node's own crypto (no native dependency); it is not byte-compatible with
 * crypto_box_seal, so both sides must use this module.
 */
const INFO = Buffer.from('fleet-seal-v1');
const EPK = 32;
const NONCE = 12;
const TAG = 16;

export function generateSealKeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('x25519');
}

export function exportSealPublicKey(key: KeyObject): string {
  return ((key.type === 'public' ? key : createPublicKey(key)).export({ format: 'jwk' }) as { x: string }).x;
}

export function importSealPublicKey(rawBase64url: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: rawBase64url }, format: 'jwk' });
}

/** sha256 (hex) of a raw X25519 public key (base64url): the fingerprint the console shows and `seal.web.ts` computes the same way. */
export function sealPublicKeyFingerprint(rawBase64url: string): string {
  return createHash('sha256').update(Buffer.from(rawBase64url, 'base64url')).digest('hex');
}

/** The raw public key (base64url) of a node's X25519 encryption key held as PEM. */
export function sealPublicKeyFromPem(pem: string): string {
  return exportSealPublicKey(createPublicKey(pem));
}

function rawPublic(key: KeyObject): Buffer {
  return Buffer.from(exportSealPublicKey(key), 'base64url');
}

function derive(shared: Buffer, epk: Buffer, recipientPk: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epk, recipientPk]), INFO, 32));
}

export function seal(plaintext: Uint8Array | string, recipientPublicKey: KeyObject): string {
  const eph = generateKeyPairSync('x25519');
  const epk = rawPublic(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPublicKey });
  const key = derive(shared, epk, rawPublic(recipientPublicKey));
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext) : plaintext), cipher.final()]);
  return Buffer.concat([epk, nonce, ct, cipher.getAuthTag()]).toString('base64url');
}

/** Returns null on any failure (wrong key, truncation, tampering): callers must not learn which. */
export function openSealed(sealed: string, recipientPrivateKey: KeyObject): Buffer | null {
  try {
    const buf = Buffer.from(sealed, 'base64url');
    if (buf.length < EPK + NONCE + TAG) return null;
    const epk = buf.subarray(0, EPK);
    const nonce = buf.subarray(EPK, EPK + NONCE);
    const tag = buf.subarray(buf.length - TAG);
    const ct = buf.subarray(EPK + NONCE, buf.length - TAG);
    const peer = importSealPublicKey(epk.toString('base64url'));
    const shared = diffieHellman({ privateKey: recipientPrivateKey, publicKey: peer });
    const key = derive(shared, epk, rawPublic(createPublicKey(recipientPrivateKey)));
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null;
  }
}

export function openSealedString(sealed: string, recipientPrivateKey: KeyObject): string | null {
  return openSealed(sealed, recipientPrivateKey)?.toString('utf8') ?? null;
}
