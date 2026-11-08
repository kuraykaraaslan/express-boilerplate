import 'reflect-metadata';
import { createHash, type Hash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { fieldsFromTransport, fieldsToTransport, type FieldCounts } from './db.tenant-bundle.fields';
import {
  appliedMigrations, forEachTenantRow, ident, MAX_MIGRATION_NAME, MAX_MIGRATIONS, NO_FIELD_KEY,
  type BundleDbOptions, type BundleRefusal, type BundleTable,
} from './db.tenant-bundle';
import { emptyMembersSummary, forEachTenantMember, hasMemberTables, memberHashLine, memberRefusal, MAX_BUNDLE_MEMBERS, MemberRefused, type BundleMember, type BundleMembersSummary } from './db.tenant-bundle.members';
export { MemberRefused };

/**
 * The STREAMED tenant bundle (docs/phases/02-fleet/05 section 6.3 "Size/time"): the same lossless rows as `db.tenant-bundle.ts` (each row as Postgres
 * renders it, `to_jsonb(row)::text`, field-encrypted values in transport form, the same per-table sha256 over `line + "\n"`), laid out so neither side
 * ever holds the whole bundle. The source writes it as it reads a server-side cursor per table; the target reads it twice from its spool: once to check
 * everything, then once inside the import transaction to write.
 *
 * Format version 4, newline-delimited; a line that starts with `[` is a control line, one that starts with `{` is a row of the table opened last:
 *
 *   ["bundle", {"v": 4, "tenantId": ..., "migrations": [...], "auditProof"?: ..., "objectStore"?: ...}]   the header, first line
 *   ["table", "<name>"]                                                               the rows of <name> follow, once per table, in import order
 *   {...}                                                                             one row
 *   ["member", {"userId": ..., "email": ..., ...}]                                   a person who holds a membership of the tenant (after the last table, before the objects; `db.tenant-bundle.members.ts`)
 *   ["object", {"key": ..., "contentType": ...}]                                    a storage object of the tenant (after the last table), its bytes follow
 *   "<base64>"                                                                        a piece of the object's bytes (canonical base64, at most 768 KiB decoded)
 *   ["object_end", {"size": n, "sha256": ...}]                                        closes the object opened last
 *   ["end", {"tables": [{"name", "rows", "sha256"}], "fields": {"reencrypted", "unreadable"}, "objects"?: {"count", "bytes", "sha256"}, "members"?: {"count", "sha256"}}]   the trailer, last line
 *
 * OBJECTS (P6-MIGRATION-BUNDLE slice 3): the tenant's storage objects travel INSIDE the same sealed, chunked, hash-pinned stream as its rows, so they are
 * sealed to the attested key, resumable by Range and covered by the sealed hash the control plane relays, with no second transfer channel to secure.
 * Every key lies under the tenant's prefix (`${tenantId}/`, `bundleObjectKeyRefusal`) and the keys come in strictly ascending byte order (so a key cannot
 * appear twice without the reader keeping a set); the trailer's `objects` is the count, the byte total and the sha256 over `[key, size, sha256]` per
 * object. A bundle without objects (and every bundle sealed before them) has no `objects` in its trailer.
 *
 * THE TARGET TRUSTS NOTHING (05 section 6.4), as for version 3: before a row is written the whole stream is scanned: the header names the migrated tenant
 * and the source's migrations; every table is known and appears once; every row is an object of the migrated tenant with only columns the table has, is not
 * node-owned, its transported fields can be encrypted under this node's key and the caller's `admitRow` admits it; the trailer lists exactly the tables
 * seen, with their row counts and the sha256 the scan computed; nothing follows it. The writing pass computes the hashes again and the transaction is
 * rolled back unless they are the scan's, so a spool that changed between the passes writes nothing.
 */
export const STREAM_BUNDLE_FORMAT_VERSION = 4;
/** The longest line a reader accepts (one row; a larger one refuses the bundle rather than buffering it). */
export const MAX_BUNDLE_LINE_BYTES = 128 * 1024 * 1024;

/** `objectStore`: the source's `objectStoreHash` (storage), so a target that shares the store knows the objects were never its own to delete. */
export interface StreamBundleHeader { v: typeof STREAM_BUNDLE_FORMAT_VERSION; tenantId: string; migrations: string[]; auditProof?: unknown; objectStore?: string }
/** The trailer's summary of the objects a bundle carries: how many, their bytes, and the sha256 over `JSON.stringify([key, size, sha256]) + "\n"` per object. */
export interface BundleObjectsSummary { count: number; bytes: number; sha256: string }
export interface StreamBundleManifest { v: typeof STREAM_BUNDLE_FORMAT_VERSION; tenantId: string; tables: { name: string; rows: number; sha256: string }[]; fields: FieldCounts; migrations: string[]; objects?: BundleObjectsSummary; members?: BundleMembersSummary }

/** The largest object a bundle carries (the largest one the app ever stores: storage's browser-direct upload cap). A larger one refuses the export or the bundle. */
export const MAX_BUNDLE_OBJECT_BYTES = 512 * 1024 * 1024;
/** Raw bytes per data line of an object (1 MiB of base64). */
const OBJECT_PIECE_BYTES = 768 * 1024;
const MAX_OBJECT_KEY_BYTES = 1024;
const MAX_CONTENT_TYPE = 255;
const objectListLine = (key: string, size: number, sha: string) => `${JSON.stringify([key, size, sha])}\n`;
const keyBytes = (k: string) => Buffer.from(k, 'utf8');

/** One object of the tenant the export carries: its key and content type, listed in strictly ascending byte order (`ORDER BY key COLLATE "C"`). */
export interface BundleObjectRef { key: string; contentType: string }
/**
 * Where the export reads the tenant's storage objects: `list` runs inside the export's snapshot (the uploads table of the same transaction), `read` answers
 * the object's bytes, or null when the store has no object at that key (the export then counts it missing and carries nothing for it). Any other failure
 * must throw, so an object that is there is never dropped silently.
 */
export interface BundleObjectSource {
  list(m: EntityManager): AsyncIterable<BundleObjectRef>;
  read(key: string): Promise<AsyncIterable<Uint8Array> | null>;
}
/** The export met more members than a bundle carries. */
export class BundleMemberError extends Error { constructor(readonly reason: 'TOO_MANY', readonly index: number) { super(`bundle member ${index}: ${reason}`); } }
/** The export met an object it must not carry (outside the tenant's prefix, out of order, too large). */
export class BundleObjectError extends Error { constructor(readonly reason: 'KEY' | 'ORDER' | 'TOO_LARGE', readonly index: number) { super(`bundle object ${index}: ${reason}`); } }

/**
 * Why a key may not travel as an object of `tenantId` (null when it may): it must lie under the tenant's prefix `${tenantId}/`, be at most 1 KiB, have
 * no empty, `.` or `..` segment, and hold no control character or backslash. A target that wrote a key outside the prefix would overwrite another
 * tenant's object in its bucket.
 */
export function bundleObjectKeyRefusal(key: unknown, tenantId: string): string | null {
  if (typeof key !== 'string' || !key.startsWith(`${tenantId}/`)) return 'PREFIX';
  if (Buffer.byteLength(key, 'utf8') > MAX_OBJECT_KEY_BYTES) return 'LENGTH';
  if (/[\u0000-\u001f\u007f\\]/.test(key)) return 'CHARACTER';
  if (key.split('/').slice(1).some((seg) => seg === '' || seg === '.' || seg === '..')) return 'SEGMENT';
  return null;
}
const CONTENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

/** A re-readable bundle: every call reads the plaintext lines again from the start. */
export type BundleLines = () => AsyncIterable<string>;

/** How the export hands out what it rendered: called with growing text, in order; awaited, so a slow sink slows the cursor. */
export type BundleSink = (text: string) => Promise<void>;
const FLUSH_CHARS = 256 * 1024;

/**
 * Streams every row of `tenantId` from `tables` (in their order) to `sink` in ONE repeatable-read transaction (a consistent snapshot while reads go on;
 * the source is frozen during a migration export), one cursor per table. `header` adds to the header line (the audit proof). Answers the manifest the
 * trailer carries and the row total.
 */
export async function exportTenantBundleStream(ds: DataSource, schema: string, tenantId: string, tables: readonly BundleTable[], sink: BundleSink, opts: BundleDbOptions & { header?: { auditProof?: unknown; objectStore?: string }; /** Also carries the members section (`db.tenant-bundle.members.ts`): the people who hold a membership of the tenant, without a credential. */ members?: boolean; batchRows?: number; objects?: BundleObjectSource; maxObjectBytes?: number } = {}): Promise<{ manifest: StreamBundleManifest; rows: number; missingObjects: number }> {
  return ds.transaction('REPEATABLE READ', async (m) => {
    if (opts.bypassRls) await m.query("SET LOCAL app.bypass_rls = 'on'");
    const codec = opts.fields ?? NO_FIELD_KEY;
    const manifest: StreamBundleManifest = { v: STREAM_BUNDLE_FORMAT_VERSION, tenantId, tables: [], fields: { reencrypted: 0, unreadable: 0 }, migrations: await appliedMigrations(m, schema) };
    let buf = '';
    const out = async (line: string) => { buf += `${line}\n`; if (buf.length >= FLUSH_CHARS) { const b = buf; buf = ''; await sink(b); } };
    const header: StreamBundleHeader = {
      v: STREAM_BUNDLE_FORMAT_VERSION, tenantId, migrations: manifest.migrations,
      ...(opts.header?.auditProof !== undefined ? { auditProof: opts.header.auditProof } : {}), ...(opts.header?.objectStore ? { objectStore: opts.header.objectStore } : {}),
    };
    await out(JSON.stringify(['bundle', header]));
    let total = 0;
    for (const t of tables) {
      await out(JSON.stringify(['table', t.name]));
      const h = createHash('sha256'); let rows = 0;
      await forEachTenantRow(m, schema, t, tenantId, async (line) => {
        if (opts.nodeOwned?.(t.name, line)) return;
        const transport = fieldsToTransport(line, codec, manifest.fields);
        h.update(`${transport}\n`, 'utf8'); rows++;
        await out(transport);
      }, opts.batchRows);
      manifest.tables.push({ name: t.name, rows, sha256: h.digest('hex') });
      total += rows;
    }
    if (opts.members && await hasMemberTables(m, schema)) {
      const sum = emptyMembersSummary();
      await forEachTenantMember(m, schema, tenantId, async (member) => {
        if (sum.count >= MAX_BUNDLE_MEMBERS) throw new BundleMemberError('TOO_MANY', sum.count + 1);
        sum.h.update(memberHashLine(member), 'utf8'); sum.count++;
        await out(JSON.stringify(['member', member]));
      }, opts.batchRows);
      manifest.members = { count: sum.count, sha256: sum.h.digest('hex') };
    }
    let missingObjects = 0;
    if (opts.objects) {
      const r = await exportObjects(m, tenantId, opts.objects, out, opts.maxObjectBytes ?? MAX_BUNDLE_OBJECT_BYTES);
      manifest.objects = r.summary; missingObjects = r.missing;
    }
    await out(JSON.stringify(['end', { tables: manifest.tables, fields: manifest.fields, ...(manifest.objects ? { objects: manifest.objects } : {}), ...(manifest.members ? { members: manifest.members } : {}) }]));
    if (buf) await sink(buf);
    return { manifest, rows: total, missingObjects };
  });
}

/** Writes the tenant's objects (after its last table): each one's control lines and its bytes in base64 pieces, hashing as it goes. */
async function exportObjects(m: EntityManager, tenantId: string, source: BundleObjectSource, out: (line: string) => Promise<void>, max: number): Promise<{ summary: BundleObjectsSummary; missing: number }> {
  const list = createHash('sha256');
  let count = 0; let bytes = 0; let missing = 0; let index = 0;
  let prev: Buffer | null = null;
  for await (const ref of source.list(m)) {
    index++;
    if (bundleObjectKeyRefusal(ref.key, tenantId)) throw new BundleObjectError('KEY', index);
    const kb = keyBytes(ref.key);
    if (prev && Buffer.compare(kb, prev) <= 0) throw new BundleObjectError('ORDER', index);
    prev = kb;
    const body = await source.read(ref.key);
    if (!body) { missing++; continue; }
    const contentType = typeof ref.contentType === 'string' && CONTENT_TYPE.test(ref.contentType) ? ref.contentType : 'application/octet-stream';
    await out(JSON.stringify(['object', { key: ref.key, contentType }]));
    const h = createHash('sha256');
    let size = 0; let pending: Buffer[] = []; let held = 0;
    for await (const chunk of body) {
      const c = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      size += c.length;
      if (size > max) throw new BundleObjectError('TOO_LARGE', index);
      h.update(c);
      pending.push(Buffer.from(c)); held += c.length;   // a copy: the source may reuse its buffer
      while (held >= OBJECT_PIECE_BYTES) {
        const all = Buffer.concat(pending);
        await out(JSON.stringify(all.subarray(0, OBJECT_PIECE_BYTES).toString('base64')));
        const rest = all.subarray(OBJECT_PIECE_BYTES);
        pending = rest.length ? [rest] : []; held = rest.length;
      }
    }
    if (held) await out(JSON.stringify(Buffer.concat(pending).toString('base64')));
    const sha = h.digest('hex');
    await out(JSON.stringify(['object_end', { size, sha256: sha }]));
    list.update(objectListLine(ref.key, size, sha), 'utf8');
    count++; bytes += size;
  }
  return { summary: { count, bytes, sha256: list.digest('hex') }, missing };
}

/**
 * Splits a byte stream into lines (on "\n"; a UTF-8 multi-byte sequence never contains that byte). The stream must end with a newline: a last line
 * without one is refused (`BundleLineError`), and so is a line longer than `maxBytes`.
 */
export class BundleLineError extends Error { constructor(readonly reason: 'LINE_TOO_LONG' | 'UNTERMINATED') { super(`bundle lines: ${reason}`); } }
export async function* linesOf(source: AsyncIterable<Uint8Array>, maxBytes = MAX_BUNDLE_LINE_BYTES): AsyncGenerator<string> {
  let parts: Buffer[] = []; let held = 0;
  for await (const chunk of source) {
    let b = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let nl = b.indexOf(10); nl >= 0; nl = b.indexOf(10)) {
      if (held + nl > maxBytes) throw new BundleLineError('LINE_TOO_LONG');
      parts.push(b.subarray(0, nl));
      yield Buffer.concat(parts).toString('utf8');
      parts = []; held = 0;
      b = b.subarray(nl + 1);
    }
    if (b.length) {
      held += b.length;
      if (held > maxBytes) throw new BundleLineError('LINE_TOO_LONG');
      parts.push(Buffer.from(b));   // a copy: the source may reuse its buffer
    }
  }
  if (held > 0) throw new BundleLineError('UNTERMINATED');
}

type Control = ['bundle' | 'table' | 'end' | 'object' | 'object_end' | 'member', unknown];
const CONTROLS = new Set(['bundle', 'table', 'end', 'object', 'object_end', 'member']);
function control(line: string): Control | null {
  try {
    const v = JSON.parse(line) as unknown;
    return Array.isArray(v) && v.length === 2 && CONTROLS.has(v[0] as string) ? (v as Control) : null;
  } catch { return null; }
}

const counted = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
const SHA = /^[a-f0-9]{64}$/;

/** The header line of a streamed bundle, or null when the first line is not one (the caller reads it before judging the audit proof). */
export async function readBundleHeader(lines: BundleLines): Promise<StreamBundleHeader | null> {
  for await (const line of lines()) {
    const c = control(line);
    if (!c || c[0] !== 'bundle') return null;
    const h = c[1] as Partial<StreamBundleHeader> | null;
    if (!h || typeof h !== 'object' || h.v !== STREAM_BUNDLE_FORMAT_VERSION || typeof h.tenantId !== 'string') return null;
    if (!Array.isArray(h.migrations) || h.migrations.length > MAX_MIGRATIONS || !h.migrations.every((n) => typeof n === 'string' && n.length > 0 && n.length <= MAX_MIGRATION_NAME)) return null;
    const keys = Object.keys(h);
    if (keys.some((k) => !['v', 'tenantId', 'migrations', 'auditProof', 'objectStore'].includes(k))) return null;
    if (h.objectStore !== undefined && (typeof h.objectStore !== 'string' || !SHA.test(h.objectStore))) return null;
    return h as StreamBundleHeader;
  }
  return null;
}

export interface ScanOptions extends Pick<BundleDbOptions, 'fields' | 'nodeOwned' | 'admitRow'> {
  /** Sees every admitted row as the bundle carries it (transport form), e.g. to find the audit head or the tenant's slug. */
  watch?: (table: string, row: Record<string, unknown>) => void;
  /** Also encrypt every transported field under this node's key (what the import will do), refusing FIELD_KEY_MISSING where it cannot. Default true. */
  decodeFields?: boolean;
  /** The largest object accepted (default `MAX_BUNDLE_OBJECT_BYTES`). */
  maxObjectBytes?: number;
  /** Judges each object before its bytes are read (the importer's own rules); a reason refuses the bundle (`OBJECT_REFUSED`). */
  admitObject?: (key: string, contentType: string) => string | null;
  /**
   * Gets every member in order, after the section's own checks passed and before the next line is read; a thrown `MemberRefused` (its reason) refuses the
   * bundle (`MEMBER_REFUSED`). The importer's writing pass batches them into the import transaction; the inspection pass judges them against the node's users.
   */
  onMember?: (member: BundleMember) => Promise<void>;
}

/**
 * The manifest a scan answers always names the objects (a count of 0 for a bundle without any). `largestObject`: the size of the largest object it
 * carries (0 without any), so an importer can refuse a bundle its store cannot write before it writes an object.
 */
export type ScanResult = { ok: true; header: StreamBundleHeader; manifest: StreamBundleManifest & { objects: BundleObjectsSummary }; rows: number; largestObject: number; members: number } | { ok: false; refusal: BundleRefusal };
/** One object as a scan delivers it, after its closing line matched its bytes. */
export interface BundleObject { key: string; contentType: string; bytes: Buffer; sha256: string }

/**
 * Scans a whole streamed bundle (the checks above) without writing anything. Every refusal is one `importTenantBundle` knows, so a caller maps them the
 * same way; a truncated or malformed stream is BAD_MANIFEST (or BAD_LINE for the line it stopped at).
 */
export async function scanTenantBundleStream(lines: BundleLines, tenantId: string, tables: readonly BundleTable[], opts: ScanOptions = {}): Promise<ScanResult> {
  return scan(lines(), tenantId, tables, opts, null);
}

/**
 * Reads the stream once more for its OBJECTS: every guard of the scan runs again, and `onObject` gets each object whole (at most `maxObjectBytes` held)
 * only once its closing line matched its size and hash. Rows are checked, not decoded. Meant for after a full scan passed (`scanTenantBundleStream`): the
 * trailer is checked only at the end, after the objects before it were handed out.
 */
export async function forEachBundleObject(lines: BundleLines, tenantId: string, tables: readonly BundleTable[], opts: Omit<ScanOptions, 'decodeFields' | 'watch'>, onObject: (o: BundleObject) => Promise<void>): Promise<ScanResult> {
  return scan(lines(), tenantId, tables, { ...opts, decodeFields: false }, null, onObject);
}

async function scan(src: AsyncIterable<string>, tenantId: string, tables: readonly BundleTable[], opts: ScanOptions, onRow: ((t: BundleTable, decoded: string) => Promise<void>) | null, onObject: ((o: BundleObject) => Promise<void>) | null = null): Promise<ScanResult> {
  const known = new Map(tables.map((t) => [t.name, t]));
  let header: StreamBundleHeader | null = null;
  let current: { t: BundleTable; columns: Set<string>; h: Hash; rows: number; line: number } | null = null;
  const seen: { name: string; rows: number; sha256: string }[] = [];
  const seenNames = new Set<string>();
  type Trailer = { tables: unknown; fields: unknown };
  let trailer: Trailer | null = null;
  let first = true;
  const close = () => { if (current) { seen.push({ name: current.t.name, rows: current.rows, sha256: current.h.digest('hex') }); current = null; } };
  // the objects section (after the last table)
  const maxObject = opts.maxObjectBytes ?? MAX_BUNDLE_OBJECT_BYTES;
  let obj: { key: string; contentType: string; h: Hash; size: number; parts: Buffer[] | null } | null = null;
  let objectsStarted = false; let objIndex = 0; let prevKey: Buffer | null = null;
  // the members section (after the last table, before the objects)
  let membersStarted = false; let memberIndex = 0; let prevMemberId = '';
  const memberSum = emptyMembersSummary();
  const membershipUsers = new Set<string>();
  const refuseMember = (reason: string): ScanResult => ({ ok: false, refusal: { code: 'MEMBER_REFUSED', reason, index: memberIndex } });
  const objList = createHash('sha256'); let objCount = 0; let objBytes = 0; let largest = 0;
  const refuseObject = (reason: string): ScanResult => ({ ok: false, refusal: { code: 'OBJECT_REFUSED', reason, index: objIndex } });
  try {
    for await (const line of src) {
      if (trailer) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };   // nothing after the trailer
      if (first) {
        first = false;
        header = await readBundleHeader(() => (async function* () { yield line; })());
        if (!header) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
        if (header.tenantId !== tenantId) return { ok: false, refusal: { code: 'TENANT_MISMATCH', table: '' } };
        continue;
      }
      if (line.startsWith('"')) {
        // a piece of the open object's bytes
        if (!obj) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
        let piece: unknown;
        try { piece = JSON.parse(line); } catch { return refuseObject('BAD_DATA'); }
        if (typeof piece !== 'string' || piece.length === 0 || piece.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(piece)) return refuseObject('BAD_DATA');
        const bytes = Buffer.from(piece, 'base64');
        if (bytes.toString('base64') !== piece) return refuseObject('BAD_DATA');   // canonical only: one encoding per byte string
        obj.size += bytes.length;
        if (obj.size > maxObject) return refuseObject('TOO_LARGE');
        obj.h.update(bytes);
        obj.parts?.push(bytes);
        continue;
      }
      if (line.startsWith('[')) {
        const c = control(line);
        if (!c || c[0] === 'bundle') return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
        if (obj && c[0] !== 'object_end') return { ok: false, refusal: { code: 'BAD_MANIFEST' } };   // an object is closed before anything else
        close();
        if (c[0] === 'member') {
          if (objectsStarted) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };   // the members come before the objects
          membersStarted = true; memberIndex++;
          if (memberIndex > MAX_BUNDLE_MEMBERS) return refuseMember('TOO_MANY');
          const why = memberRefusal(c[1]);
          if (why) return refuseMember(why);
          const member = c[1] as BundleMember;
          if (member.userId <= prevMemberId) return refuseMember('ORDER');   // strictly ascending: a person cannot appear twice
          prevMemberId = member.userId;
          // the tables came first, so the memberships are all known: a person who holds none of THIS tenant is not carried
          if (!membershipUsers.has(member.userId)) return refuseMember('NOT_A_MEMBER');
          memberSum.h.update(memberHashLine(member), 'utf8'); memberSum.count++;
          if (opts.onMember) {
            try { await opts.onMember(member); } catch (e) { if (e instanceof MemberRefused) return refuseMember(e.reason); throw e; }
          }
          continue;
        }
        if (c[0] === 'object') {
          objectsStarted = true; objIndex++;
          const meta = c[1] as { key?: unknown; contentType?: unknown } | null;
          if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.keys(meta).some((k) => k !== 'key' && k !== 'contentType')) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
          if (bundleObjectKeyRefusal(meta.key, tenantId)) return refuseObject('KEY');
          const key = meta.key as string;
          if (typeof meta.contentType !== 'string' || meta.contentType.length > MAX_CONTENT_TYPE || !CONTENT_TYPE.test(meta.contentType)) return refuseObject('BAD_DATA');
          const kb = keyBytes(key);
          if (prevKey && Buffer.compare(kb, prevKey) <= 0) return refuseObject('ORDER');
          prevKey = kb;
          const reason = opts.admitObject?.(key, meta.contentType);
          if (reason) return refuseObject(reason);
          obj = { key, contentType: meta.contentType, h: createHash('sha256'), size: 0, parts: onObject ? [] : null };
          continue;
        }
        if (c[0] === 'object_end') {
          if (!obj) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
          const meta = c[1] as { size?: unknown; sha256?: unknown } | null;
          if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.keys(meta).length !== 2 || !counted(meta.size) || typeof meta.sha256 !== 'string' || !SHA.test(meta.sha256)) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
          const sha = obj.h.digest('hex');
          if (meta.size !== obj.size || meta.sha256 !== sha) return refuseObject('HASH');
          objList.update(objectListLine(obj.key, obj.size, sha), 'utf8');
          objCount++; objBytes += obj.size; largest = Math.max(largest, obj.size);
          const done = obj; obj = null;
          if (onObject) await onObject({ key: done.key, contentType: done.contentType, bytes: Buffer.concat(done.parts!), sha256: sha });
          continue;
        }
        if (c[0] === 'end') { trailer = (c[1] && typeof c[1] === 'object' ? c[1] : { tables: null, fields: null }) as Trailer; continue; }
        if (objectsStarted || membersStarted) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };   // no table after the members or the objects
        const name = c[1];
        if (typeof name !== 'string') return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
        const t = known.get(name);
        if (!t) return { ok: false, refusal: { code: 'UNKNOWN_TABLE', table: name } };
        if (seenNames.has(name)) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
        seenNames.add(name);
        current = { t, columns: new Set(t.columns), h: createHash('sha256'), rows: 0, line: 0 };
        continue;
      }
      if (!current) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
      const cur: { t: BundleTable; columns: Set<string>; h: Hash; rows: number; line: number } = current;
      const table = cur.t.name; const at = ++cur.line;
      let row: unknown;
      try { row = JSON.parse(line); } catch { return { ok: false, refusal: { code: 'BAD_LINE', table, line: at } }; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, refusal: { code: 'BAD_LINE', table, line: at } };
      if ((row as { tenantId?: unknown }).tenantId !== tenantId) return { ok: false, refusal: { code: 'FOREIGN_TENANT', table, line: at } };
      for (const k of Object.keys(row)) if (!cur.columns.has(k)) return { ok: false, refusal: { code: 'UNKNOWN_COLUMN', table, column: k } };
      if (opts.nodeOwned?.(table, line)) return { ok: false, refusal: { code: 'NODE_OWNED_ROW', table, line: at } };
      let decoded = line;
      if (opts.decodeFields !== false || onRow) {
        try { decoded = fieldsFromTransport(line, opts.fields ?? NO_FIELD_KEY); } catch { return { ok: false, refusal: { code: 'FIELD_KEY_MISSING', table } }; }
        const reason = opts.admitRow?.(table, decoded);
        if (reason) return { ok: false, refusal: { code: 'ROW_REFUSED', table, line: at, reason } };
      }
      cur.h.update(`${line}\n`, 'utf8'); cur.rows++;
      opts.watch?.(table, row as Record<string, unknown>);
      if (table === 'tenant_members' && typeof (row as { userId?: unknown }).userId === 'string') membershipUsers.add((row as { userId: string }).userId);
      if (onRow) await onRow(cur.t, decoded);
    }
  } catch (e) {
    if (e instanceof BundleLineError) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
    throw e;
  }
  close();
  if (!header || !trailer || obj) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };   // empty, or cut before the trailer
  if (Object.keys(trailer).some((k) => k !== 'tables' && k !== 'fields' && k !== 'objects' && k !== 'members')) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  const objects: BundleObjectsSummary = { count: objCount, bytes: objBytes, sha256: objList.digest('hex') };
  const listedObjects = (trailer as { objects?: unknown }).objects;
  if (listedObjects === undefined) {
    if (objCount > 0) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  } else {
    const o = listedObjects as Partial<BundleObjectsSummary> | null;
    if (!o || typeof o !== 'object' || Object.keys(o).length !== 3 || o.count !== objects.count || o.bytes !== objects.bytes || o.sha256 !== objects.sha256) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  }
  const members: BundleMembersSummary = { count: memberSum.count, sha256: memberSum.h.digest('hex') };
  const listedMembers = (trailer as { members?: unknown }).members;
  if (listedMembers === undefined) {
    if (memberSum.count > 0) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  } else {
    const o = listedMembers as Partial<BundleMembersSummary> | null;
    if (!o || typeof o !== 'object' || Object.keys(o).length !== 2 || o.count !== members.count || o.sha256 !== members.sha256) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  }
  const { tables: listed, fields } = trailer as Trailer;
  const f = fields as Partial<FieldCounts> | null;
  if (!f || typeof f !== 'object' || !counted(f.reencrypted) || !counted(f.unreadable) || Object.keys(f).length !== 2) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  if (!Array.isArray(listed) || listed.length !== seen.length) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  for (const [i, s] of seen.entries()) {
    const e = listed[i] as { name?: unknown; rows?: unknown; sha256?: unknown } | null;
    if (!e || e.name !== s.name || !counted(e.rows) || typeof e.sha256 !== 'string' || !SHA.test(e.sha256)) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
    if (e.sha256 !== s.sha256) return { ok: false, refusal: { code: 'HASH_MISMATCH', table: s.name } };
    if (e.rows !== s.rows) return { ok: false, refusal: { code: 'ROW_COUNT_MISMATCH', table: s.name } };
  }
  for (const t of tables) if (!seenNames.has(t.name)) return { ok: false, refusal: { code: 'MISSING_TABLE', table: t.name } };
  const manifest: StreamBundleManifest & { objects: BundleObjectsSummary } = { v: STREAM_BUNDLE_FORMAT_VERSION, tenantId, tables: seen, fields: { reencrypted: f.reencrypted!, unreadable: f.unreadable! }, migrations: header.migrations, objects, ...(listedMembers !== undefined ? { members } : {}) };
  return { ok: true, header, manifest, rows: seen.reduce((n, s) => n + s.rows, 0), largestObject: largest, members: memberSum.count };
}

/** Rows per INSERT of the writing pass (`jsonb_populate_recordset`), and the most characters one batch carries. */
const INSERT_BATCH_ROWS = 500;
const INSERT_BATCH_CHARS = 4 * 1024 * 1024;
/** Members per call of the importer's `writeMembers`. */
export const MEMBER_BATCH = 500;

/** Thrown inside the writing pass when the stream read the second time is not the one scanned: the transaction is rolled back. */
class StreamChanged extends Error { constructor(readonly refusal: BundleRefusal) { super('the bundle changed between the scan and the import'); } }

/**
 * Imports a streamed bundle into `schema`: scans the whole stream first (nothing is written unless it passes, and a source whose schema is ahead is
 * refused as `SCHEMA_AHEAD`), then reads it again inside ONE transaction and writes it table by table, parents before children (the bundle's table order
 * must be `tables`' order), in batches. Every row or none. `opts` as for `importTenantBundle` (the audit chain's `beforeRows` / `afterRows` included).
 */
export async function importTenantBundleStream(ds: DataSource, schema: string, tenantId: string, lines: BundleLines, tables: readonly BundleTable[], opts: BundleDbOptions & Pick<ScanOptions, 'watch' | 'admitObject' | 'maxObjectBytes'> & {
  /**
   * Writes the members of the bundle (batches of at most `MEMBER_BATCH`, inside the import transaction, after the last row of every table it has seen). A
   * `MemberRefused` thrown from it refuses the bundle and rolls everything back. A bundle that carries members and no writer is refused: people are never dropped silently.
   */
  writeMembers?: (m: EntityManager, members: BundleMember[]) => Promise<void>;
} = {}): Promise<{ ok: true; rows: Record<string, number>; manifest: StreamBundleManifest & { objects: BundleObjectsSummary } } | { ok: false; refusal: BundleRefusal }> {
  const objectRules = { admitObject: opts.admitObject, maxObjectBytes: opts.maxObjectBytes };
  const scanned = await scan(lines(), tenantId, tables, { fields: opts.fields, nodeOwned: opts.nodeOwned, admitRow: opts.admitRow, watch: opts.watch, ...objectRules }, null);
  if (!scanned.ok) return scanned;
  if (scanned.members > 0 && !opts.writeMembers) return { ok: false, refusal: { code: 'MEMBER_REFUSED', reason: 'UNSUPPORTED', index: 0 } };
  const order = new Map(tables.map((t, i) => [t.name, i]));
  if (scanned.manifest.tables.some((t, i) => order.get(t.name) !== i)) return { ok: false, refusal: { code: 'BAD_MANIFEST' } };
  const mine = new Set(await appliedMigrations(ds, schema));
  const ahead = scanned.manifest.migrations.filter((n) => !mine.has(n));
  if (ahead.length) return { ok: false, refusal: { code: 'SCHEMA_AHEAD', missing: ahead.length, first: ahead[0]! } };

  const rows: Record<string, number> = {};
  try {
    await ds.transaction(async (m: EntityManager) => {
      if (opts.bypassRls) await m.query("SET LOCAL app.bypass_rls = 'on'");
      if (opts.beforeRows) await opts.beforeRows(m);
      let batch: string[] = []; let chars = 0; let batchTable: BundleTable | null = null;
      const flush = async () => {
        if (!batchTable || batch.length === 0) return;
        const target = `${ident(schema)}.${ident(batchTable.name)}`;
        await m.query(`INSERT INTO ${target} SELECT * FROM jsonb_populate_recordset(NULL::${target}, $1::jsonb)`, [`[${batch.join(',')}]`]);
        rows[batchTable.name] = (rows[batchTable.name] ?? 0) + batch.length;
        batch = []; chars = 0;
      };
      const pending: BundleMember[] = [];
      const writeMembers = async (): Promise<void> => {
        if (pending.length === 0 || !opts.writeMembers) return;
        try { await opts.writeMembers(m, pending.splice(0)); } catch (e) { if (e instanceof MemberRefused) throw new StreamChanged({ code: 'MEMBER_REFUSED', reason: e.reason, index: 0 }); throw e; }
      };
      const again = await scan(lines(), tenantId, tables, {
        fields: opts.fields, nodeOwned: opts.nodeOwned, admitRow: opts.admitRow, ...objectRules,
        onMember: async (member) => { pending.push(member); if (pending.length >= MEMBER_BATCH) await writeMembers(); },
      }, async (t, decoded) => {
        if (batchTable !== t) { await flush(); batchTable = t; }
        batch.push(decoded); chars += decoded.length;
        if (batch.length >= INSERT_BATCH_ROWS || chars >= INSERT_BATCH_CHARS) await flush();
      });
      await flush();
      await writeMembers();
      if (!again.ok) throw new StreamChanged(again.refusal);
      if (JSON.stringify(again.manifest.tables) !== JSON.stringify(scanned.manifest.tables) || JSON.stringify(again.manifest.objects) !== JSON.stringify(scanned.manifest.objects) || JSON.stringify(again.manifest.members) !== JSON.stringify(scanned.manifest.members)) throw new StreamChanged({ code: 'HASH_MISMATCH', table: '' });
      for (const t of tables) rows[t.name] ??= 0;
      if (opts.afterRows) await opts.afterRows(m);
    });
  } catch (e) {
    if (e instanceof StreamChanged) return { ok: false, refusal: e.refusal };
    // A value unique on this node is already taken here (a slug, a custom domain, ...): the transaction wrote nothing, and the caller learns which.
    const pg = (e as { driverError?: { code?: string; table?: string; constraint?: string } }).driverError;
    if (pg?.code === '23505') return { ok: false, refusal: { code: 'UNIQUE_CONFLICT', table: pg.table ?? '', constraint: pg.constraint ?? '' } };
    throw e;
  }
  return { ok: true, rows, manifest: scanned.manifest };
}

/** A version-3 bundle (`TenantBundle` plus the audit proof) as streamed lines, so one import path serves both (a source sealed before streaming). */
export function linesOfBundleV3(bundle: { manifest: { tenantId: string; tables: { name: string; rows: number; sha256: string }[]; fields: FieldCounts; migrations: string[] }; files: Record<string, string>; auditProof?: unknown }): BundleLines {
  return async function* () {
    const { manifest, files } = bundle;
    yield JSON.stringify(['bundle', { v: STREAM_BUNDLE_FORMAT_VERSION, tenantId: manifest.tenantId, migrations: manifest.migrations, ...(bundle.auditProof !== undefined ? { auditProof: bundle.auditProof } : {}) }]);
    for (const t of manifest.tables) {
      yield JSON.stringify(['table', t.name]);
      const ndjson = files[t.name] ?? '';
      if (ndjson) for (const line of ndjson.slice(0, -1).split('\n')) yield line;
    }
    yield JSON.stringify(['end', { tables: manifest.tables, fields: manifest.fields }]);
  };
}
