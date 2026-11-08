import { canonicalize } from './canonical';
import { TenantInitSchema, type TenantInit } from './tenant-init.schema';

/**
 * The sealed box of `seal.ts`, built on WebCrypto so the operator's browser seals what the control plane must never read (docs/phases/02-fleet roadmap
 * Phase 9: provisioning inputs sealed in the operator's browser). Same construction and wire format: ephemeral X25519 -> HKDF-SHA256(salt = epk ||
 * recipient pk, info `fleet-seal-v1`) -> AES-256-GCM, base64url(epk[32] || nonce[12] || ciphertext || tag[16]); a node opens it with `openSealed`.
 * No Node APIs: it runs in the browser and, for the tests, in Node's own WebCrypto.
 */
const INFO = new TextEncoder().encode('fleet-seal-v1');

const toB64u = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (text: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** sha256 (hex) of a node's raw X25519 sealing key: what the console shows the operator to compare, and what the control plane checks it sealed to. */
export async function sealKeyFingerprint(recipientRawB64u: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', fromB64u(recipientRawB64u)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seals `plaintext` to the node's raw X25519 public key (base64url, 32 bytes), exactly as `seal` does. */
export async function sealForNode(plaintext: string | Uint8Array, recipientRawB64u: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const recipient = fromB64u(recipientRawB64u);
  if (recipient.length !== 32) throw new Error('the node key is not a 32-byte X25519 key');
  const peer = await subtle.importKey('raw', recipient, { name: 'X25519' }, false, []);
  const eph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const shared = await subtle.deriveBits({ name: 'X25519', public: peer }, eph.privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const keyBytes = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: concat(epk, recipient), info: INFO }, ikm, 256);
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  const ctAndTag = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data as Uint8Array<ArrayBuffer>));
  return toB64u(concat(epk, nonce, ctAndTag));
}

/** Seals a validated tenant init to the home node, as `sealTenantInit` does on the server. Throws on an invalid init or key. */
export async function sealTenantInitForNode(init: TenantInit, recipientRawB64u: string, subtle?: SubtleCrypto): Promise<string> {
  return sealForNode(canonicalize(TenantInitSchema.parse(init)), recipientRawB64u, subtle);
}
