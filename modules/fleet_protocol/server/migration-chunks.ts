import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * The CHUNK MANIFEST of a sealed migration bundle (docs/phases/02-fleet/05 section 6.3 "Size/time": resumable): the source cuts the sealed bytes into
 * fixed-size chunks when it seals the export and keeps, next to the bundle, the sha256 of every chunk. The target pulls the manifest first, then the
 * chunks one HTTP Range at a time over the peer lane, checks each chunk against the manifest BEFORE it keeps it, and records how many it holds, so an
 * interrupted transfer resumes at the first chunk it does not have instead of starting again.
 *
 * WHAT THE MANIFEST IS TRUSTED FOR. It names the sealed bundle's sha256 (`sealedSha256`), which the target compares with the hash the control plane
 * relayed from the export's answer before it fetches a single chunk; and once the last chunk is in, the target hashes the whole sealed stream and compares
 * it with that relayed hash again before anything opens it, and every later pass of the import is pinned to the bytes that check read (fleet_agent
 * `pinSource`). So the relayed hash stays the only authority: a manifest that lies about a chunk can delay the
 * transfer (the whole-stream check refuses it and the spool is dropped), never get a byte opened that the export did not seal. The per-chunk hashes are
 * what make a resume safe (a corrupt or truncated chunk is caught where it is, not after hours) and a tampered chunk visible by its index.
 *
 * G only: sizes and hashes of ciphertext.
 */
export const BUNDLE_CHUNK_BYTES = 8 * 1024 * 1024;
/** The largest chunk a manifest may name (a peer response is at most one chunk). */
export const MAX_BUNDLE_CHUNK_BYTES = 64 * 1024 * 1024;
/** At most this many chunks (8 MiB chunks: 512 GiB; the manifest stays under 5 MB of JSON). */
export const MAX_BUNDLE_CHUNKS = 65_536;

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

export const ChunkManifestSchema = z.object({
  v: z.literal(1),
  /** sha256 (hex) of the whole sealed stream: the value the export answered as SEALED_BUNDLE. */
  sealedSha256: sha256Hex,
  /** Bytes of the sealed stream. */
  size: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  chunkSize: z.number().int().min(1).max(MAX_BUNDLE_CHUNK_BYTES),
  /** sha256 (hex) of each chunk, in order; every chunk is `chunkSize` bytes but the last. */
  chunks: z.array(sha256Hex).min(1).max(MAX_BUNDLE_CHUNKS),
}).strict().refine((m) => m.chunks.length === Math.ceil(m.size / m.chunkSize), 'the chunk count does not match the size');
export type ChunkManifest = z.infer<typeof ChunkManifestSchema>;

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The manifest of a sealed stream, cut into `chunkSize` chunks. */
export function chunkManifestOf(sealed: Uint8Array, chunkSize: number = BUNDLE_CHUNK_BYTES): ChunkManifest {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_BUNDLE_CHUNK_BYTES) throw new Error('chunk size out of range');
  if (sealed.length === 0) throw new Error('an empty stream has no manifest');
  const chunks: string[] = [];
  for (let at = 0; at < sealed.length; at += chunkSize) chunks.push(sha256(sealed.subarray(at, Math.min(at + chunkSize, sealed.length))));
  if (chunks.length > MAX_BUNDLE_CHUNKS) throw new Error('too many chunks');
  return { v: 1, sealedSha256: sha256(sealed), size: sealed.length, chunkSize, chunks };
}

/** The byte range of chunk `index`: `start` inclusive, `end` exclusive. */
export function chunkBounds(m: Pick<ChunkManifest, 'size' | 'chunkSize'>, index: number): { start: number; end: number } {
  const start = index * m.chunkSize;
  return { start, end: Math.min(start + m.chunkSize, m.size) };
}

/** Whether `bytes` are exactly chunk `index` of the manifest (its length and its hash). */
export function chunkMatches(m: ChunkManifest, index: number, bytes: Uint8Array): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= m.chunks.length) return false;
  const { start, end } = chunkBounds(m, index);
  return bytes.length === end - start && sha256(bytes) === m.chunks[index];
}

/**
 * A single `Range: bytes=<first>-[<last>]` request against a stream of `size` bytes, as the half-open range it asks for, clamped to `maxBytes`; null when
 * there is no header; 'UNSATISFIABLE' for anything else (several ranges, a suffix range, a range past the end, a malformed header): the peer lane serves
 * exactly the one-range form the target sends.
 */
export function parseByteRange(header: string | null | undefined, size: number, maxBytes: number): { start: number; end: number } | null | 'UNSATISFIABLE' {
  if (header === null || header === undefined) return null;
  const m = /^bytes=(\d{1,15})-(\d{0,15})$/.exec(header.trim());
  if (!m) return 'UNSATISFIABLE';
  const start = Number(m[1]);
  const last = m[2] === '' ? size - 1 : Number(m[2]);
  if (start >= size || last < start) return 'UNSATISFIABLE';
  return { start, end: Math.min(last + 1, size, start + maxBytes) };
}

/**
 * Cuts a sealed stream that is still being written into manifest chunks: `push` takes the sealed bytes as they come and hands every complete chunk to
 * `onChunk` (its index, bytes and sha256), `finish` hands over the last one and answers the manifest. So the source never holds more than one chunk of
 * the sealed bundle, and the manifest is the one `chunkManifestOf` would compute over the whole stream.
 */
export class ChunkCutter {
  private readonly whole = createHash('sha256');
  private readonly hashes: string[] = [];
  private parts: Buffer[] = [];
  private held = 0;
  private size = 0;
  private finished = false;

  constructor(readonly chunkSize: number, private readonly onChunk: (index: number, bytes: Buffer, sha256: string) => Promise<void>) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_BUNDLE_CHUNK_BYTES) throw new Error('chunk size out of range');
  }

  private async emit(bytes: Buffer): Promise<void> {
    if (this.hashes.length >= MAX_BUNDLE_CHUNKS) throw new Error('too many chunks');
    const h = sha256(bytes);
    this.hashes.push(h);
    await this.onChunk(this.hashes.length - 1, bytes, h);
  }

  async push(bytes: Uint8Array): Promise<void> {
    if (this.finished) throw new Error('chunk cutter already finished');
    let b = Buffer.from(bytes);   // a copy: the caller may reuse its buffer
    this.whole.update(b); this.size += b.length;
    while (b.length > 0) {
      const take = Math.min(this.chunkSize - this.held, b.length);
      this.parts.push(b.subarray(0, take)); this.held += take;
      b = b.subarray(take);
      if (this.held === this.chunkSize) {
        const chunk = Buffer.concat(this.parts);
        this.parts = []; this.held = 0;
        await this.emit(chunk);
      }
    }
  }

  async finish(): Promise<ChunkManifest> {
    if (this.finished) throw new Error('chunk cutter already finished');
    this.finished = true;
    if (this.held > 0) { const chunk = Buffer.concat(this.parts); this.parts = []; this.held = 0; await this.emit(chunk); }
    if (this.size === 0) throw new Error('an empty stream has no manifest');
    return { v: 1, sealedSha256: this.whole.digest('hex'), size: this.size, chunkSize: this.chunkSize, chunks: this.hashes };
  }
}
