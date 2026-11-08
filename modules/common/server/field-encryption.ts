import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { registerMetricSource } from './process-hooks';

/**
 * AES-256-GCM field-level encryption for sensitive DB columns (TOTP secrets, OAuth tokens, etc.). Two wire formats, all parts base64url and
 * joined by `.`:
 *
 *  - `v1.{iv}.{ciphertext}.{authTag}`: under this node's field key (SETTINGS_ENCRYPTION_KEY), no key id. What `encryptField` writes.
 *  - `v2.{kid}.{iv}.{ciphertext}.{authTag}` (docs/phases/02-fleet/04 section 3, P7-TDEK): the key is named by `kid` and `v2.{kid}` is bound as
 *    GCM additional data, so an envelope cannot be relabelled to another key. Two kinds of kid: `ndek-<fingerprint>` is this node's field key
 *    (`nodeFieldKid()`), and every other kid is resolved by the key resolver another module registers (`configureFieldKeyResolver`): the
 *    per-tenant data keys of the db module (`tdek-<tenantId>-<generation>`, db.tenant-keys.service.ts) are resolved that way, from an in-memory
 *    cache, so decryption stays synchronous; so are the per-user data keys (`udek-<userId>-<generation>`, db.user-keys.service.ts, decision F27).
 *
 * Readers accept both formats (dual read); `encryptField` still writes v1 so that a rollback to a release before v2 can read every node-key
 * value it wrote (reader first, writer later). v2 is written by `encryptFieldWithKey` (the tenant keys) and, in a later release, for the node key.
 *
 * `decryptField` THROWS a `FieldDecryptError` naming the kid and the reason, and counts it in `field_decrypt_failures_total{reason}` (a G-class
 * process metric: closed label set, no kid, no tenant). `decryptFieldOpt` keeps its lenient contract for the existing callers (null on a
 * failure) but the failure is counted all the same (risk register common.16 stays open for the callers that still use it).
 *
 * encryptFieldOpt / decryptFieldOpt are safe to call when the env var is absent: they return the plaintext unchanged so the `single` role stays
 * functional until the operator configures the key (`FLEET_ROLE=node|fleet` refuses to boot without it, env.schema.ts).
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';
const VERSION_2 = 'v2';
const PREFIX = `${VERSION}.`;
const PREFIX_2 = `${VERSION_2}.`;

/** A key id: what a v2 envelope may name. Never contains `.`, the part separator. */
export const FIELD_KID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// The 64-hex key is injected at boot by the env module (see
// `@kuraykaraaslan-labs/env`) rather than imported here, so `common` stays a
// dependency-free leaf (no env / db / redis / next / react imports).
let keyProvider: () => string | undefined = () => undefined;

/** Resolves a non-node kid to its 32-byte key, or undefined when this process does not hold it (yet). Synchronous by design. */
export type FieldKeyResolver = (kid: string) => Buffer | undefined;
let keyResolver: FieldKeyResolver = () => undefined;

/** Wire the SETTINGS_ENCRYPTION_KEY source at boot (called from the env module). */
export function configureFieldEncryptionKey(provider: () => string | undefined): void {
  keyProvider = provider;
}

// 38-security 5.5: key rotation. During a rotation window the process holds the NEW key (SETTINGS_ENCRYPTION_KEY, which every write uses) and the
// OLD one(s) (SETTINGS_ENCRYPTION_KEY_PREVIOUS, comma separated), so values written under an old key still open until `reencryptField` has rewritten
// them. A v1 envelope names no key, so it is tried under the current key and then each previous one (GCM authentication says which is right);
// a v2 `ndek-` envelope names its key and is opened under whichever of the held keys has that fingerprint.
let previousKeysProvider: () => string | undefined = () => undefined;

/** Wire the source of the previous node field keys (called from the env module). */
export function configureFieldEncryptionPreviousKeys(provider: () => string | undefined): void {
  previousKeysProvider = provider;
}

function previousKeys(): Buffer[] {
  const raw = previousKeysProvider();
  if (!raw) return [];
  return raw.split(',').map((k) => k.trim()).filter((k) => /^[0-9a-fA-F]{64}$/.test(k)).map((k) => Buffer.from(k, 'hex'));
}

/** Wire the resolver of non-node kids (the db module's tenant keys). One resolver per process; a later call replaces it. */
export function configureFieldKeyResolver(resolver: FieldKeyResolver | null): void {
  keyResolver = resolver ?? (() => undefined);
}

function loadKey(): Buffer {
  const raw = keyProvider();
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be set to 64 hex chars (32 bytes) for field encryption');
  }
  return Buffer.from(raw, 'hex');
}

/** The kid of a node field key: `ndek-` and 16 base64url chars of a domain-separated SHA-256 of the key (names the key, reveals nothing of it). */
export function fieldKidOf(key: Buffer): string {
  return `ndek-${createHash('sha256').update('nb.field.kid.v1:').update(key).digest('base64url').slice(0, 16)}`;
}

/**
 * A 32-byte key derived from this node's field key for one purpose (HKDF-SHA256, `info` names the purpose), so another key owner (the db module's
 * `node-key` tenant-key provider) gets its own key without the field key itself ever leaving this module. Throws without a configured field key.
 */
export function deriveNodeFieldSubkey(info: string): Buffer {
  if (!/^[a-z0-9.:_-]{1,64}$/.test(info)) throw new Error('field encryption: invalid subkey purpose');
  return Buffer.from(hkdfSync('sha256', loadKey(), Buffer.from('nb.field.subkey.v1'), Buffer.from(info), 32));
}

/**
 * A keyed blind index of `value` for one purpose (P7-TDEK): HMAC-SHA256 under a subkey of `key` derived for `purpose` (HKDF-SHA256), hex. Lets a
 * column sealed with a random IV still be found by equality (`recipientHash = :h`) without storing the value: the index is unlinkable across keys
 * and purposes, and once the key is destroyed nobody can compute it again (crypto-shredding covers the index too). The caller normalises `value`.
 */
export function blindIndexWithKey(key: Buffer, purpose: string, value: string): string {
  if (!/^[a-z0-9.:_-]{1,64}$/.test(purpose)) throw new Error('field encryption: invalid blind-index purpose');
  if (key.length !== 32) throw new Error('field encryption: a blind-index key is 32 bytes');
  const subkey = Buffer.from(hkdfSync('sha256', key, Buffer.from('nb.blind-index.v1'), Buffer.from(purpose), 32));
  return createHmac('sha256', subkey).update(value, 'utf8').digest('hex');
}

/** The kid of this node's field key, or null when none is configured. */
export function nodeFieldKid(): string | null {
  try { return fieldKidOf(loadKey()); } catch { return null; }
}

// ── failures: typed and counted ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Why an envelope did not open. A closed set: the metric's only label. WRONG_TENANT is raised by a tenant-aware reader (db.tenant-keys.service.ts)
 * when a row of one tenant carries an envelope under ANOTHER tenant's key, WRONG_USER by the user-aware reader (db.user-keys.service.ts, decision
 * F27) when a person's row carries an envelope under another user's key: never opened, always counted.
 */
export const FIELD_DECRYPT_REASONS = ['MALFORMED', 'NO_NODE_KEY', 'KEY_UNAVAILABLE', 'AUTH_FAILED', 'WRONG_TENANT', 'WRONG_USER'] as const;
export type FieldDecryptReason = (typeof FIELD_DECRYPT_REASONS)[number];

/** A field envelope that could not be opened. `kid` is the key it names (`v1` for a v1 envelope, null when malformed); never the value. */
export class FieldDecryptError extends Error {
  constructor(readonly reason: FieldDecryptReason, readonly kid: string | null, message: string) {
    super(message);
    this.name = 'FieldDecryptError';
  }
}

const failures = new Map<FieldDecryptReason, number>(FIELD_DECRYPT_REASONS.map((r) => [r, 0]));

/** A counted `FieldDecryptError`, for a key owner that refuses an envelope before opening it (the caller throws it). */
export function fieldDecryptFailure(reason: FieldDecryptReason, kid: string | null, message: string): FieldDecryptError {
  failures.set(reason, (failures.get(reason) ?? 0) + 1);
  return new FieldDecryptError(reason, kid, message);
}

function fail(reason: FieldDecryptReason, kid: string | null, message: string): never {
  throw fieldDecryptFailure(reason, kid, message);
}

/** The failures counted by this process since start, per reason (the series of `field_decrypt_failures_total`). */
export function fieldDecryptFailures(): Record<FieldDecryptReason, number> {
  return Object.fromEntries(FIELD_DECRYPT_REASONS.map((r) => [r, failures.get(r) ?? 0])) as Record<FieldDecryptReason, number>;
}

/** Test seam. */
export function resetFieldDecryptFailures(): void {
  for (const r of FIELD_DECRYPT_REASONS) failures.set(r, 0);
}

// A counter offered as a collect-time gauge (the process registry has no pull counter): it only grows, so rate() and increase() work.
registerMetricSource({
  name: 'field_decrypt_failures_total',
  help: 'Field-encryption envelopes this process could not open, by reason (closed set; no key id, no tenant).',
  labelNames: ['reason'],
  read: async () => FIELD_DECRYPT_REASONS.map((reason) => ({ labels: { reason }, value: failures.get(reason) ?? 0 })),
});

// ── encrypt / decrypt ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function isEncryptedField(value: string | null | undefined): boolean {
  return typeof value === 'string' && (value.startsWith(PREFIX) || value.startsWith(PREFIX_2));
}

function seal(key: Buffer, plaintext: string, aad: Buffer | null): [Buffer, Buffer, Buffer] {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, ciphertext, cipher.getAuthTag()];
}

export function encryptField(plaintext: string): string {
  const key = loadKey();
  const [iv, ciphertext, tag] = seal(key, plaintext, null);
  return [VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

/** A v2 envelope of `plaintext` under `key`, named `kid` (bound as additional data). For the key owners (tenant keys); throws on a bad kid or key. */
export function encryptFieldWithKey(kid: string, key: Buffer, plaintext: string): string {
  if (!FIELD_KID_RE.test(kid)) throw new Error('field encryption: invalid kid');
  if (key.length !== 32) throw new Error('field encryption: a key is 32 bytes');
  const [iv, ciphertext, tag] = seal(key, plaintext, Buffer.from(`${VERSION_2}.${kid}`, 'utf8'));
  return [VERSION_2, kid, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

/** The kid an envelope names: `v1` for a v1 envelope (the node key, unnamed), the kid of a v2 one, or null for anything else. */
export function envelopeKid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith(PREFIX)) return VERSION;
  if (!value.startsWith(PREFIX_2)) return null;
  const kid = value.slice(PREFIX_2.length, value.indexOf('.', PREFIX_2.length));
  return FIELD_KID_RE.test(kid) ? kid : null;
}

/** `open` without the counted failure: null when the envelope does not authenticate under `key`. */
function tryOpen(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer, aad: Buffer | null): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function open(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer, aad: Buffer | null, kid: string): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return fail('AUTH_FAILED', kid, `field envelope did not authenticate under key ${kid} (wrong key or tampered)`);
  }
}

/**
 * Opens a v1 or v2 envelope. Throws `FieldDecryptError` (counted) when the value is not an envelope, its key is not available, or it does not
 * authenticate. The messages keep the v1 wording ('Invalid encrypted field format', 'Invalid auth tag length', SETTINGS_ENCRYPTION_KEY).
 */
export function decryptField(encoded: string): string {
  return decryptWith(encoded, keyResolver);
}

/**
 * `decryptField` with the named (non-node) keys taken from `resolve` instead of the process-wide resolver: for a caller that holds the keys it
 * needs for the whole of a long read (the migration export holds the tenant's keys, which the resolver's cache could drop half way). A v1 or
 * node-key v2 envelope still opens under the node key. Same counted failures as `decryptField`.
 */
export function decryptFieldWithKeys(encoded: string, resolve: FieldKeyResolver): string {
  return decryptWith(encoded, resolve);
}

function decryptWith(encoded: string, resolveKey: FieldKeyResolver): string {
  const parts = typeof encoded === 'string' ? encoded.split('.') : [];
  if (parts.length === 4 && parts[0] === VERSION) {
    const iv = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (tag.length !== TAG_BYTES) fail('MALFORMED', VERSION, 'Invalid auth tag length');
    let key: Buffer;
    try { key = loadKey(); } catch (e) { return fail('NO_NODE_KEY', VERSION, (e as Error).message); }
    // Rotation window: an unnamed v1 envelope may have been written under a previous key.
    const old = previousKeys();
    if (old.length > 0) {
      const current = tryOpen(key, iv, ciphertext, tag, null);
      if (current !== null) return current;
      for (const k of old) {
        const opened = tryOpen(k, iv, ciphertext, tag, null);
        if (opened !== null) return opened;
      }
    }
    return open(key, iv, ciphertext, tag, null, VERSION);
  }
  if (parts.length === 5 && parts[0] === VERSION_2 && FIELD_KID_RE.test(parts[1])) {
    const kid = parts[1];
    const iv = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    const tag = Buffer.from(parts[4], 'base64url');
    if (iv.length !== IV_BYTES) fail('MALFORMED', kid, 'Invalid encrypted field format');
    if (tag.length !== TAG_BYTES) fail('MALFORMED', kid, 'Invalid auth tag length');
    let key: Buffer | undefined;
    if (kid.startsWith('ndek-')) {
      let node: Buffer;
      try { node = loadKey(); } catch (e) { return fail('NO_NODE_KEY', kid, (e as Error).message); }
      key = fieldKidOf(node) === kid ? node : previousKeys().find((k) => fieldKidOf(k) === kid);
    } else {
      try { key = resolveKey(kid); } catch { key = undefined; }
    }
    if (!key || key.length !== 32) return fail('KEY_UNAVAILABLE', kid, `field key ${kid} is not available in this process`);
    return open(key, iv, ciphertext, tag, Buffer.from(`${VERSION_2}.${kid}`, 'utf8'), kid);
  }
  return fail('MALFORMED', null, 'Invalid encrypted field format');
}

/**
 * Whether `value` is a node-key envelope that does NOT open under the CURRENT key (it opens only under a previous one): what a re-encrypt run still has
 * to rewrite. False for plaintext, for tenant / user key envelopes (their keys rotate through the db module) and for anything already current.
 */
export function needsReencrypt(value: string | null | undefined): boolean {
  if (!isEncryptedField(value)) return false;
  const parts = (value as string).split('.');
  let current: Buffer;
  try { current = loadKey(); } catch { return false; }
  if (parts.length === 4 && parts[0] === VERSION) {
    const [iv, ct, tag] = [parts[1], parts[2], parts[3]].map((p) => Buffer.from(p, 'base64url')) as [Buffer, Buffer, Buffer];
    return tryOpen(current, iv, ct, tag, null) === null;
  }
  if (parts.length === 5 && parts[0] === VERSION_2 && parts[1].startsWith('ndek-')) return parts[1] !== fieldKidOf(current);
  return false;
}

/**
 * The same plaintext sealed under the CURRENT key, or null when the value needs no rewrite (plaintext, another key owner, already current). Throws
 * (counted) when the value needs a rewrite but its old key is not held: that row must not be silently skipped.
 */
export function reencryptField(value: string | null | undefined): string | null {
  if (!needsReencrypt(value)) return null;
  return encryptField(decryptField(value as string));
}

/** Encrypt when key is configured; pass through when it isn't. */
export function encryptFieldOpt(plaintext: string): string {
  if (keyProvider()) return encryptField(plaintext);
  // common.16: a production process without a key refuses to store a secret rather than writing it in plaintext and saying
  // nothing. Development and test keep the pass-through (they run without a key on purpose).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Field encryption key is not configured (SETTINGS_ENCRYPTION_KEY): refusing to store a secret in plaintext.');
  }
  return plaintext;
}

/** Decrypt when value looks encrypted; pass through otherwise. A failure is counted and answered with null (legacy lenient contract). */
export function decryptFieldOpt(value: string | null | undefined): string | null | undefined {
  if (!isEncryptedField(value)) return value;
  try {
    return decryptField(value as string);
  } catch {
    return null;
  }
}

/**
 * The strict shape of an envelope this module writes: `v1.` (or `v2.<kid>.`) then a 12-byte IV, a ciphertext and a 16-byte tag, each base64url.
 * Stricter than {@link isEncryptedField} (a prefix test): a plaintext that merely begins with `v1.` is not an envelope. Written so that the same
 * text is a valid JavaScript and PostgreSQL (POSIX ARE) regular expression: the node judge `secrets.no_plaintext_columns` (fleet_agent
 * app.checks.sql.ts) and the column backfill (db.encrypted-columns.ts) use this very pattern.
 */
export const FIELD_ENVELOPE_PATTERN = '^(v1|v2\\.[A-Za-z0-9_-]{1,80})\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]{22}$';
const ENVELOPE_RE = new RegExp(FIELD_ENVELOPE_PATTERN);

export function isFieldEnvelope(value: unknown): value is string {
  return typeof value === 'string' && ENVELOPE_RE.test(value);
}

/** A well-formed v2 envelope under a key other than this node's field key (`ndek-…`): a tenant's or a user's data key, opened only by its owner's reader. */
export function isForeignKeyEnvelope(value: unknown): value is string {
  if (!isFieldEnvelope(value) || !value.startsWith(PREFIX_2)) return false;
  const kid = envelopeKid(value);
  return kid !== null && !kid.startsWith('ndek-');
}

/**
 * Envelopes this process read but could not open (another node's key, a rotated key, damage), kept so that writing the row back stores the
 * same envelope instead of encrypting the envelope text as if it were a plaintext. Bounded: the oldest entry goes first.
 */
const unreadable = new Set<string>();
const UNREADABLE_MAX = 1024;

function rememberUnreadable(envelope: string): void {
  if (unreadable.has(envelope)) return;
  if (unreadable.size >= UNREADABLE_MAX) unreadable.delete(unreadable.values().next().value as string);
  unreadable.add(envelope);
}

/**
 * A TypeORM column transformer (structurally `ValueTransformer`; `common` imports no ORM) that keeps a string column field-encrypted at rest.
 *
 *  - write (`to`): null, undefined and '' are stored as they are; any other string is encrypted under SETTINGS_ENCRYPTION_KEY (v1). Without a key
 *    the value is stored in clear (the `single` role may run without one; `FLEET_ROLE=node|fleet` refuses to boot without it, env.schema.ts).
 *    An envelope this process could not open on read is written back unchanged, so saving a row never double-encrypts it nor loses it.
 *  - read (`from`): an envelope is decrypted; a value that is not one is a row written before the column was encrypted and is returned as
 *    it is (dual read: the next save, or the deploy backfill, encrypts it). An envelope that cannot be opened is returned AS THE ENVELOPE:
 *    a caller that needs the secret checks {@link isFieldEnvelope} and refuses, instead of signing with or serving a wrong value.
 *  - a v2 envelope under a key that is NOT this node's field key (a tenant data key, `tdek-…`, P7-TDEK, or a user data key, `udek-…`, F27) is held
 *    for its key owner: never opened on read (the owning module opens it through the owner-aware reader, db.tenant-keys.service.ts
 *    `decrypt(tenantId, value)` or db.user-keys.service.ts `decrypt(userId, value)`, which refuse another owner's key; this transformer cannot know
 *    the row's owner) and written back unchanged. So a declared column can carry this transformer as its
 *    safety net: a writer that forgot to seal under the tenant key still stores a node-key envelope, never a plaintext, and the backfill moves it.
 *
 * The comparison of TypeORM's save runs `to` on both sides, so a loaded and saved row is rewritten with a fresh IV; harmless.
 */
export const encryptedColumnTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') return value;
    if (unreadable.has(value) || isForeignKeyEnvelope(value)) return value;
    return encryptFieldOpt(value);
  },
  from(value: string | null | undefined): string | null | undefined {
    if (!isFieldEnvelope(value)) return value;
    if (isForeignKeyEnvelope(value)) return value;
    try {
      return decryptField(value);
    } catch {
      rememberUnreadable(value);
      return value;
    }
  },
};
