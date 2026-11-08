import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import { exportSealPublicKey, importSealPublicKey } from './seal';

/**
 * The STREAMING sealed box of a migration bundle (docs/phases/02-fleet/05 section 6.3 "Size/time"): the same anonymous-sender construction as `seal.ts`
 * (an ephemeral X25519 key, HKDF-SHA256 over the shared secret with salt = epk || recipient pk, AES-256-GCM), but the plaintext is cut into fixed-size
 * RECORDS, each sealed on its own under the one derived key, so neither side ever holds the whole bundle: the source seals as the export streams out of
 * PostgreSQL, the target opens record by record as it reads its spool.
 *
 * Wire: header = MAGIC "FSS1" (4) || epk (32) || nonce prefix (7, random) || record size (u32 BE), then the records, each `len(plaintext) + 16` bytes.
 * Every record but the last carries exactly `recordBytes` of plaintext; the last carries 0..recordBytes. Record i is AES-256-GCM with
 * nonce = prefix (7) || i (u32 BE) || last (1 byte: 1 on the final record, else 0) and the whole header as additional data (the STREAM construction of
 * Hoang, Reyhanitabar, Rogaway and Vizar). So a record cannot be reordered (its index is in the nonce), dropped from the end (the new last record was
 * sealed with last = 0 and does not open as final), extended (nothing may follow the final record) or moved under another header.
 *
 * WHAT A READER MAY TRUST. A record that opens proves only that it was sealed under THIS header's epk to the recipient key, and anyone who knows the
 * recipient PUBLIC key can produce such a stream with an epk of their own: the construction is anonymous-sender, so opening says nothing about who
 * sealed it. Origin comes only from outside: the sha256 of the whole sealed stream, signed by the control plane (the migration's `sealedBundleHash`),
 * checked over exactly the bytes every pass then consumes (the import pins its passes to the hashed bytes, `pinSource` in fleet_agent). Within a stream
 * that hash vouches for, the records protect order, truncation and extension; and the stream is complete only when `end()` returned: whoever consumes
 * plaintext before that must be able to throw it away (the import scans the whole stream before it writes a row, then opens it again for the writing
 * pass).
 * Domain separation from `seal.ts`: its own HKDF info (`fleet-seal-stream-v1`), so a key derived for one construction is never the other's.
 */
export const SEAL_STREAM_MAGIC = Buffer.from('FSS1', 'ascii');
const INFO = Buffer.from('fleet-seal-stream-v1');
const EPK = 32;
const PREFIX = 7;
const TAG = 16;
export const SEAL_STREAM_HEADER_BYTES = SEAL_STREAM_MAGIC.length + EPK + PREFIX + 4;
/** Plaintext bytes per record by default (1 MiB): the most either side holds of a bundle at once, besides one transport chunk. */
export const SEAL_STREAM_RECORD_BYTES = 1024 * 1024;
/** The largest record a reader accepts (a hostile header must not make it buffer more). */
export const MAX_SEAL_STREAM_RECORD_BYTES = 16 * 1024 * 1024;
/** At most 2^32 records: the index is a u32 in the nonce. */
const MAX_RECORDS = 0xffff_ffff;

export class SealStreamError extends Error {
  constructor(readonly reason: 'BAD_HEADER' | 'CANNOT_OPEN' | 'TRUNCATED' | 'TRAILING_DATA' | 'TOO_LONG') { super(`sealed stream: ${reason}`); }
}

const rawPublic = (key: KeyObject): Buffer => Buffer.from(exportSealPublicKey(key.type === 'public' ? key : createPublicKey(key)), 'base64url');
const derive = (shared: Buffer, epk: Buffer, recipientPk: Buffer): Buffer => Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epk, recipientPk]), INFO, 32));

function nonceOf(prefix: Buffer, index: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0);
  n.writeUInt32BE(index, PREFIX);
  n[11] = last ? 1 : 0;
  return n;
}

/** Whether `head` starts like a sealed stream (the magic). A one-shot `seal.ts` box starts with a random key and is told apart by failing to open. */
export function isSealStream(head: Uint8Array): boolean {
  return head.length >= SEAL_STREAM_MAGIC.length && Buffer.from(head.subarray(0, SEAL_STREAM_MAGIC.length)).equals(SEAL_STREAM_MAGIC);
}

/**
 * Seals a stream to `recipientPublicKey`: `push` takes plaintext as it comes and returns the sealed bytes ready so far (the header first), `final` returns
 * the rest, ending with the final record. Holds at most one record of plaintext.
 */
export class SealStreamWriter {
  private readonly key: Buffer;
  private readonly prefix = randomBytes(PREFIX);
  private readonly header: Buffer;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private index = 0;
  private headerOut = false;
  private done = false;

  constructor(recipientPublicKey: KeyObject, readonly recordBytes: number = SEAL_STREAM_RECORD_BYTES) {
    if (!Number.isInteger(recordBytes) || recordBytes < 1 || recordBytes > MAX_SEAL_STREAM_RECORD_BYTES) throw new Error('record size out of range');
    const eph = generateKeyPairSync('x25519');
    const epk = rawPublic(eph.publicKey);
    this.key = derive(diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPublicKey }), epk, rawPublic(recipientPublicKey));
    const size = Buffer.alloc(4); size.writeUInt32BE(recordBytes);
    this.header = Buffer.concat([SEAL_STREAM_MAGIC, epk, this.prefix, size]);
  }

  private record(plain: Buffer, last: boolean): Buffer {
    if (this.index >= MAX_RECORDS) throw new SealStreamError('TOO_LONG');
    const c = createCipheriv('aes-256-gcm', this.key, nonceOf(this.prefix, this.index++, last));
    c.setAAD(this.header);
    return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  }

  private head(out: Buffer[]): void {
    if (!this.headerOut) { out.push(this.header); this.headerOut = true; }
  }

  push(plain: Uint8Array | string): Buffer {
    if (this.done) throw new Error('sealed stream already final');
    const out: Buffer[] = [];
    this.head(out);
    let buf = typeof plain === 'string' ? Buffer.from(plain, 'utf8') : Buffer.from(plain);   // a copy: the caller may reuse its buffer
    while (buf.length > 0) {
      const take = Math.min(this.recordBytes - this.pendingBytes, buf.length);
      this.pending.push(buf.subarray(0, take)); this.pendingBytes += take;
      buf = buf.subarray(take);
      // a full record is sealed as non-final only once more plaintext exists: the final record may be a full one
      if (this.pendingBytes === this.recordBytes && buf.length > 0) {
        out.push(this.record(Buffer.concat(this.pending), false));
        this.pending = []; this.pendingBytes = 0;
      }
    }
    return Buffer.concat(out);
  }

  final(): Buffer {
    if (this.done) throw new Error('sealed stream already final');
    const out: Buffer[] = [];
    this.head(out);
    out.push(this.record(Buffer.concat(this.pending), true));
    this.pending = []; this.pendingBytes = 0; this.done = true;
    return Buffer.concat(out);
  }
}

/**
 * Opens a sealed stream with `recipientPrivateKey`: `push` takes sealed bytes as they come and returns the plaintext of every record that opened, `end`
 * opens the last one and throws unless it was sealed as final. Any failure throws a `SealStreamError` (the reason never says more than that), and the
 * reader is then unusable. Holds at most one record (plus a partial one) of ciphertext.
 */
export class SealStreamReader {
  private key: Buffer | null = null;
  private header: Buffer | null = null;
  private prefix: Buffer | null = null;
  private recordBytes = 0;
  private buf: Buffer = Buffer.alloc(0);
  private index = 0;
  private failed = false;
  private ended = false;

  constructor(private readonly recipientPrivateKey: KeyObject) {}

  private fail(reason: SealStreamError['reason']): never { this.failed = true; throw new SealStreamError(reason); }

  private open(sealed: Buffer, last: boolean): Buffer {
    if (this.index >= MAX_RECORDS) this.fail('TOO_LONG');
    try {
      const d = createDecipheriv('aes-256-gcm', this.key!, nonceOf(this.prefix!, this.index, last));
      d.setAAD(this.header!);
      d.setAuthTag(sealed.subarray(sealed.length - TAG));
      const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
      this.index++;
      return plain;
    } catch { return this.fail('CANNOT_OPEN'); }
  }

  private readHeader(): boolean {
    if (this.buf.length < SEAL_STREAM_HEADER_BYTES) return false;
    const h = this.buf.subarray(0, SEAL_STREAM_HEADER_BYTES);
    if (!isSealStream(h)) this.fail('BAD_HEADER');
    const epk = h.subarray(4, 4 + EPK);
    const size = h.readUInt32BE(4 + EPK + PREFIX);
    if (size < 1 || size > MAX_SEAL_STREAM_RECORD_BYTES) this.fail('BAD_HEADER');
    try {
      const shared = diffieHellman({ privateKey: this.recipientPrivateKey, publicKey: importSealPublicKey(Buffer.from(epk).toString('base64url')) });
      this.key = derive(shared, Buffer.from(epk), rawPublic(this.recipientPrivateKey));
    } catch { this.fail('BAD_HEADER'); }
    this.header = Buffer.from(h);
    this.prefix = Buffer.from(h.subarray(4 + EPK, 4 + EPK + PREFIX));
    this.recordBytes = size;
    this.buf = this.buf.subarray(SEAL_STREAM_HEADER_BYTES);
    return true;
  }

  push(sealed: Uint8Array): Buffer[] {
    if (this.failed || this.ended) throw new SealStreamError('TRAILING_DATA');
    this.buf = this.buf.length ? Buffer.concat([this.buf, sealed]) : Buffer.from(sealed);
    if (!this.key && !this.readHeader()) return [];
    const out: Buffer[] = [];
    const full = this.recordBytes + TAG;
    // a full record is opened as non-final only once a byte after it exists: the final record may be full-sized
    while (this.buf.length > full) {
      out.push(this.open(this.buf.subarray(0, full), false));
      this.buf = this.buf.subarray(full);
    }
    return out;
  }

  end(): Buffer[] {
    if (this.failed || this.ended) throw new SealStreamError('TRAILING_DATA');
    if (!this.key) this.fail(this.buf.length < SEAL_STREAM_HEADER_BYTES ? 'TRUNCATED' : 'BAD_HEADER');
    if (this.buf.length < TAG) this.fail('TRUNCATED');
    const last = this.open(this.buf, true);
    this.buf = Buffer.alloc(0); this.ended = true;
    return [last];
  }
}

/** Opens every record of a sealed byte source in order, yielding plaintext; throws `SealStreamError` on any failure, including a missing final record. */
export async function* openSealStream(source: AsyncIterable<Uint8Array>, recipientPrivateKey: KeyObject): AsyncGenerator<Buffer> {
  const r = new SealStreamReader(recipientPrivateKey);
  for await (const part of source) for (const plain of r.push(part)) yield plain;
  for (const plain of r.end()) yield plain;
}
