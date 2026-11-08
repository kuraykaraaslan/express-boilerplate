import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';

/**
 * A minimal implementation of the age v1 file format (https://age-encryption.org/v1) for X25519 identities, in pure `node:crypto`
 * (X25519, HKDF-SHA256, HMAC-SHA256, ChaCha20-Poly1305), so `common` stays a dependency-free leaf.
 *
 * Purpose (X4-7, docs/phases/02-fleet/04 section 3): the region KEK may be kept age-encrypted on the node's secrets volume and opened with an
 * age identity that the regional partner controls (an identity file on an HSM-backed or separate host, mounted read-only), instead of lying
 * there in the clear. Only what that needs is built:
 *
 *  - decryption of binary and ASCII-armored files to X25519 identities (`AGE-SECRET-KEY-1...`), checked against the C2SP CCTV age test kit;
 *  - encryption to X25519 recipients (`age1...`), used by tests and tooling; the files it writes open with the reference `age` tool.
 *
 * Not built: scrypt (passphrase) and post-quantum hybrid recipients, and plugin identities (`AGE-PLUGIN-...`, e.g. a YubiKey): their stanzas
 * are ignored like any unknown stanza, so a file sealed only to them ends in `NO_MATCH`. The whole plaintext is held in memory and returned
 * only after the last chunk authenticated: a truncated or tampered file never releases a prefix.
 */

export type AgeErrorCode = 'ARMOR' | 'HEADER' | 'NO_MATCH' | 'HMAC' | 'PAYLOAD' | 'IDENTITY';

export class AgeError extends Error {
  constructor(readonly code: AgeErrorCode, message: string) {
    super(`age: ${message}`);
    this.name = 'AgeError';
  }
}

const VERSION_LINE = 'age-encryption.org/v1';
const CHUNK = 64 * 1024;
const TAG = 16;
const ARMOR_BEGIN = '-----BEGIN AGE ENCRYPTED FILE-----';
const ARMOR_END = '-----END AGE ENCRYPTED FILE-----';
const X25519_INFO = 'age-encryption.org/v1/X25519';
/** The largest plaintext `ageDecrypt` accepts; a KEK file is 32 bytes, this is only a guard against a huge input. */
export const AGE_MAX_PLAINTEXT = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------------------------- bech32

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < 0 || v >> from !== 0) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

/** Bech32 (BIP 173, without the 90-character limit, as age uses it) decoding; the result's hrp is lower case. */
export function bech32Decode(text: string): { hrp: string; data: Buffer } {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) throw new AgeError('IDENTITY', 'mixed-case bech32 string');
  const s = text.toLowerCase();
  const sep = s.lastIndexOf('1');
  if (sep < 1 || sep + 7 > s.length) throw new AgeError('IDENTITY', 'malformed bech32 string');
  const hrp = s.slice(0, sep);
  for (const c of hrp) {
    const code = c.charCodeAt(0);
    if (code < 33 || code > 126) throw new AgeError('IDENTITY', 'malformed bech32 string');
  }
  const values: number[] = [];
  for (const c of s.slice(sep + 1)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) throw new AgeError('IDENTITY', 'malformed bech32 string');
    values.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...values]) !== 1) throw new AgeError('IDENTITY', 'bech32 checksum mismatch');
  const bytes = convertBits(values.slice(0, -6), 5, 8, false);
  if (!bytes) throw new AgeError('IDENTITY', 'malformed bech32 string');
  return { hrp, data: Buffer.from(bytes) };
}

export function bech32Encode(hrp: string, data: Buffer): string {
  const values = convertBits(data, 8, 5, true) as number[];
  const mod = polymod([...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...values, ...checksum].map((v) => BECH32_CHARSET[v]).join('');
}

// ---------------------------------------------------------------------------------------------------------------------------------- X25519

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

function privateKeyObject(scalar: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PKCS8_X25519, scalar]), format: 'der', type: 'pkcs8' });
}

function publicKeyObject(point: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_X25519, point]), format: 'der', type: 'spki' });
}

function rawPublic(key: KeyObject): Buffer {
  return Buffer.from((key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_X25519.length));
}

/** An X25519 identity: the secret scalar and its recipient (public point). */
export interface AgeIdentity {
  readonly secret: Buffer;
  readonly recipient: Buffer;
}

export function parseAgeIdentity(text: string): AgeIdentity {
  const trimmed = text.trim();
  if (/^AGE-PLUGIN-/i.test(trimmed)) throw new AgeError('IDENTITY', 'plugin identities (AGE-PLUGIN-...) are not supported; use an X25519 identity');
  const { hrp, data } = bech32Decode(trimmed);
  if (hrp !== 'age-secret-key-' || data.length !== 32) throw new AgeError('IDENTITY', 'not an X25519 age identity (AGE-SECRET-KEY-1...)');
  const secret = Buffer.from(data);
  return { secret, recipient: rawPublic(createPublicKey(privateKeyObject(secret))) };
}

/** Parses an age identity file: one identity per line, `#` comments and blank lines ignored; at least one identity. */
export function parseAgeIdentityFile(contents: string): AgeIdentity[] {
  const ids = contents.split('\n').map((l) => l.replace(/\r$/, '').trim()).filter((l) => l && !l.startsWith('#')).map(parseAgeIdentity);
  if (ids.length === 0) throw new AgeError('IDENTITY', 'the identity file holds no identity');
  return ids;
}

export function parseAgeRecipient(text: string): Buffer {
  const { hrp, data } = bech32Decode(text.trim());
  if (hrp !== 'age' || data.length !== 32) throw new AgeError('IDENTITY', 'not an X25519 age recipient (age1...)');
  return Buffer.from(data);
}

export function formatAgeIdentity(id: AgeIdentity): string {
  return bech32Encode('age-secret-key-', id.secret).toUpperCase();
}

export function formatAgeRecipient(recipient: Buffer): string {
  return bech32Encode('age', recipient);
}

/** A fresh X25519 identity (tests and tooling; the regional partner normally generates it with `age-keygen` on its own host). */
export function generateAgeIdentity(): AgeIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const secret = Buffer.from((privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(PKCS8_X25519.length));
  return { secret, recipient: rawPublic(publicKey) };
}

// ---------------------------------------------------------------------------------------------------------------------------------- primitives

function hkdf(ikm: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, 32));
}

function sealChaCha(key: Buffer, nonce: Buffer, plaintext: Buffer): Buffer {
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function openChaCha(key: Buffer, nonce: Buffer, sealed: Buffer): Buffer | null {
  if (sealed.length < TAG) return null;
  const d = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG });
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
  } catch {
    return null;
  }
}

const B64_RE = /^[A-Za-z0-9+/]*$/;

/** Strict unpadded base64: only the standard alphabet, no padding, and the canonical encoding (no stray low bits). */
function decodeB64NoPad(s: string): Buffer | null {
  if (!B64_RE.test(s) || s.length % 4 === 1) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.toString('base64').replace(/=+$/, '') === s ? buf : null;
}

function b64NoPad(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------------------------------------------------------------- armor

/** True when the input looks like an age file (binary header or ASCII armor), after leading whitespace. */
export function isAgeFile(contents: Buffer): boolean {
  const head = contents.subarray(0, 256).toString('latin1').replace(/^[ \t\r\n]+/, '');
  return head.startsWith(VERSION_LINE + '\n') || head.startsWith(ARMOR_BEGIN);
}

function dearmor(contents: Buffer): Buffer {
  const text = contents.toString('latin1').replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '');
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length < 2 || lines[0] !== ARMOR_BEGIN || lines[lines.length - 1] !== ARMOR_END) throw new AgeError('ARMOR', 'malformed armor');
  const body = lines.slice(1, -1);
  body.forEach((line, i) => {
    const last = i === body.length - 1;
    if (!/^[A-Za-z0-9+/=]*$/.test(line) || line.length > 64 || line.length === 0 || (!last && line.length !== 64)) {
      throw new AgeError('ARMOR', 'malformed armor line');
    }
  });
  const b64 = body.join('');
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new AgeError('ARMOR', 'malformed armor base64');
  const data = Buffer.from(b64, 'base64');
  if (data.toString('base64') !== b64) throw new AgeError('ARMOR', 'non-canonical armor base64');
  return data;
}

function armor(data: Buffer): string {
  const b64 = data.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return [ARMOR_BEGIN, ...lines, ARMOR_END, ''].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------- header

interface Stanza { type: string; args: string[]; body: Buffer }

interface Header { stanzas: Stanza[]; macInput: Buffer; mac: Buffer; payloadStart: number }

function parseHeader(data: Buffer): Header {
  let pos = 0;
  const nextLine = (): string => {
    const nl = data.indexOf(0x0a, pos);
    if (nl < 0) throw new AgeError('HEADER', 'truncated header');
    const line = data.subarray(pos, nl).toString('latin1');
    pos = nl + 1;
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c < 32 || c > 126) throw new AgeError('HEADER', 'invalid character in header');
    }
    return line;
  };
  if (nextLine() !== VERSION_LINE) throw new AgeError('HEADER', 'unsupported version');
  const stanzas: Stanza[] = [];
  for (;;) {
    const lineStart = pos;
    const line = nextLine();
    if (line.startsWith('---')) {
      if (!line.startsWith('--- ')) throw new AgeError('HEADER', 'malformed MAC line');
      const mac = decodeB64NoPad(line.slice(4));
      if (!mac || mac.length !== 32) throw new AgeError('HEADER', 'malformed MAC');
      return { stanzas, macInput: data.subarray(0, lineStart + 3), mac, payloadStart: pos };
    }
    if (!line.startsWith('-> ')) throw new AgeError('HEADER', 'malformed stanza');
    const args = line.slice(3).split(' ');
    if (args.some((a) => a.length === 0)) throw new AgeError('HEADER', 'empty stanza argument');
    const parts: Buffer[] = [];
    for (;;) {
      const bodyLine = nextLine();
      if (bodyLine.length > 64) throw new AgeError('HEADER', 'stanza body line too long');
      const chunk = decodeB64NoPad(bodyLine);
      if (!chunk) throw new AgeError('HEADER', 'malformed stanza body');
      parts.push(chunk);
      if (bodyLine.length < 64) break;
    }
    stanzas.push({ type: args[0], args: args.slice(1), body: Buffer.concat(parts) });
  }
}

/** The X25519 stanzas, checked for shape before any is tried (a malformed one is a header failure, not a non-match). */
function x25519Stanzas(stanzas: Stanza[]): Array<{ share: Buffer; body: Buffer }> {
  return stanzas.filter((s) => s.type === 'X25519').map((s) => {
    if (s.args.length !== 1) throw new AgeError('HEADER', 'X25519 stanza needs exactly one argument');
    const share = decodeB64NoPad(s.args[0]);
    if (!share || share.length !== 32) throw new AgeError('HEADER', 'malformed X25519 share');
    if (s.body.length !== 32) throw new AgeError('HEADER', 'X25519 stanza body is not a 16-byte file key');
    return { share, body: s.body };
  });
}

function unwrapFileKey(stanzas: Stanza[], identities: AgeIdentity[]): Buffer {
  for (const st of x25519Stanzas(stanzas)) {
    for (const id of identities) {
      let shared: Buffer;
      try {
        shared = diffieHellman({ privateKey: privateKeyObject(id.secret), publicKey: publicKeyObject(st.share) });
      } catch {
        throw new AgeError('HEADER', 'invalid X25519 share');
      }
      if (shared.every((b) => b === 0)) throw new AgeError('HEADER', 'X25519 share is a low-order point');
      const wrapKey = hkdf(shared, Buffer.concat([st.share, id.recipient]), X25519_INFO);
      const fileKey = openChaCha(wrapKey, Buffer.alloc(12), st.body);
      if (fileKey) return fileKey;
    }
  }
  throw new AgeError('NO_MATCH', 'no identity matches any recipient of the file');
}

function chunkNonce(counter: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  n.writeUIntBE(counter, 5, 6);
  n[11] = last ? 1 : 0;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------------- API

/** Decrypts an age file (binary or armored; `armored` unset = detected) with the given X25519 identities. Throws `AgeError` naming the failing stage. */
export function ageDecrypt(contents: Buffer, identities: AgeIdentity[], opts: { armored?: boolean } = {}): Buffer {
  const armored = opts.armored ?? contents.subarray(0, 64).toString('latin1').replace(/^[ \t\r\n]+/, '').startsWith('-----BEGIN');
  const data = armored ? dearmor(contents) : contents;
  const header = parseHeader(data);
  if (identities.length === 0) throw new AgeError('IDENTITY', 'no identity given');
  const fileKey = unwrapFileKey(header.stanzas, identities);
  const mac = createHmac('sha256', hkdf(fileKey, Buffer.alloc(0), 'header')).update(header.macInput).digest();
  if (!timingSafeEqual(mac, header.mac)) throw new AgeError('HMAC', 'header MAC mismatch');

  if (data.length - header.payloadStart < 16) throw new AgeError('HEADER', 'missing payload nonce');
  const nonce = data.subarray(header.payloadStart, header.payloadStart + 16);
  const key = hkdf(fileKey, nonce, 'payload');
  let rest = data.subarray(header.payloadStart + 16);
  if (rest.length === 0) throw new AgeError('PAYLOAD', 'no STREAM chunk');
  if (rest.length > AGE_MAX_PLAINTEXT + Math.ceil(AGE_MAX_PLAINTEXT / CHUNK + 1) * TAG) throw new AgeError('PAYLOAD', 'payload too large');
  const out: Buffer[] = [];
  for (let counter = 0; ; counter++) {
    const last = rest.length <= CHUNK + TAG;
    const sealed = last ? rest : rest.subarray(0, CHUNK + TAG);
    const plain = openChaCha(key, chunkNonce(counter, last), sealed);
    if (!plain) throw new AgeError('PAYLOAD', 'STREAM chunk does not authenticate');
    if (last) {
      if (plain.length === 0 && counter > 0) throw new AgeError('PAYLOAD', 'empty final chunk');
      out.push(plain);
      return Buffer.concat(out);
    }
    out.push(plain);
    rest = rest.subarray(CHUNK + TAG);
  }
}

/** Encrypts to X25519 recipients (raw 32-byte points); `armored` yields the ASCII armor. */
export function ageEncrypt(plaintext: Buffer, recipients: Buffer[], opts: { armored?: boolean } = {}): Buffer {
  if (recipients.length === 0) throw new AgeError('IDENTITY', 'no recipient given');
  if (plaintext.length > AGE_MAX_PLAINTEXT) throw new AgeError('PAYLOAD', 'plaintext too large');
  const fileKey = randomBytes(16);
  const lines = [VERSION_LINE];
  for (const recipient of recipients) {
    const eph = generateAgeIdentity();
    const shared = diffieHellman({ privateKey: privateKeyObject(eph.secret), publicKey: publicKeyObject(recipient) });
    const wrapKey = hkdf(shared, Buffer.concat([eph.recipient, recipient]), X25519_INFO);
    const body = b64NoPad(sealChaCha(wrapKey, Buffer.alloc(12), fileKey));
    lines.push(`-> X25519 ${b64NoPad(eph.recipient)}`, body);   // a 43-character body: one short line ends the stanza
  }
  const macInput = Buffer.from(lines.join('\n') + '\n---', 'latin1');
  const mac = createHmac('sha256', hkdf(fileKey, Buffer.alloc(0), 'header')).update(macInput).digest();
  const nonce = randomBytes(16);
  const key = hkdf(fileKey, nonce, 'payload');
  const chunks: Buffer[] = [];
  const count = Math.max(1, Math.ceil(plaintext.length / CHUNK));
  for (let i = 0; i < count; i++) chunks.push(sealChaCha(key, chunkNonce(i, i === count - 1), plaintext.subarray(i * CHUNK, (i + 1) * CHUNK)));
  const file = Buffer.concat([macInput, Buffer.from(` ${b64NoPad(mac)}\n`, 'latin1'), nonce, ...chunks]);
  return opts.armored ? Buffer.from(armor(file), 'latin1') : file;
}
