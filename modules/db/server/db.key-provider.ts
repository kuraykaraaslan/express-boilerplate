import { randomBytes } from 'node:crypto';
import { closeSync, constants, fsyncSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deriveNodeFieldSubkey } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { AGE_IDENTITY_FILE_LABEL, loadKekFile, ownerOnlyProblem } from '@kuraykaraaslan-labs/common/server/kek-source';
import { unwrapUnderKek, wrapUnderKek } from '@kuraykaraaslan-labs/common/server/key-wrap';
import type { TenantKeyProviderKind } from './entities/tenant_key.entity';

/**
 * The node's key provider for tenant data keys (P7-TDEK; docs/phases/02-fleet/04 section 3): it wraps and unwraps a tenant data key (TDEK) under a
 * named SLOT (`<kid>` for the key itself, `hold-<kid>` for its legal-hold escrow) and destroys a slot. The db module's key service
 * (db.tenant-keys.service.ts) stores only what `wrap` returns; the raw key exists in process memory only.
 *
 * Two providers are built, two are interfaces:
 *
 *  - `node-key` (the default; also the only choice of a `single` deployment without a key store): the wrapping key is derived from this node's
 *    field key (HKDF, `deriveNodeFieldSubkey('tdek.wrap.v1')`). `destroy` holds nothing to remove: the service clears the wrapped key in its row,
 *    so the live database can no longer open the tenant's columns, but a database BACKUP taken before the destroy still holds the wrapped key and
 *    the node key opens it. `shredsBackups` is false and the deletion receipt says so.
 *  - `file` (the age/keyfile mode of 04 section 3 for small partners): every slot is its own random 32-byte key in a file of the key store
 *    directory, wrapped under the region KEK (the same 32-byte KEK file and AES-GCM wrap as the fleet agent's private keys, common/server/key-wrap.ts).
 *    The key store lives on the host's secrets volume, outside the database and its backup repository, so `destroy` (overwrite, fsync, unlink)
 *    makes the tenant's columns unreadable in every database backup as well: crypto-shredding. `shredsBackups` is true.
 *  - `kms` and `vault`: the same interface backed by the regional KMS or Vault transit; not implemented, selecting one fails loudly.
 */
export interface TenantKeyProvider {
  readonly kind: TenantKeyProviderKind;
  /** True when `destroy` removes key material that lives outside the application database, so a backup taken before it cannot be decrypted either. */
  readonly shredsBackups: boolean;
  /** Wraps a 32-byte data key under `slot` (creating the slot when the provider keeps one). */
  wrap(slot: string, dek: Buffer): Promise<string>;
  /** Opens what `wrap` returned for `slot`; throws `TenantKeySlotGoneError` when the slot was destroyed, another error when it does not open. */
  unwrap(slot: string, wrapped: string): Promise<Buffer>;
  /** Destroys the slot for good. Idempotent: a slot that is already gone is not an error. */
  destroy(slot: string): Promise<void>;
}

/** The slot a key was wrapped under no longer exists (destroyed): the key is gone. */
export class TenantKeySlotGoneError extends Error {
  constructor(readonly slot: string) {
    super(`tenant key slot ${slot} has been destroyed`);
    this.name = 'TenantKeySlotGoneError';
  }
}

/** A slot name: a kid (`tdek-<uuid>-<n>`) or `hold-<kid>`. Never a path. */
export const SLOT_RE = /^[A-Za-z0-9_-]{1,100}$/;

function checkSlot(slot: string): void {
  if (!SLOT_RE.test(slot)) throw new Error('tenant key provider: invalid slot name');
}

function checkDek(dek: Buffer): void {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('tenant key provider: a data key is 32 bytes');
}

const NODE_WRAP_PREFIX = 'tdekn1';

/** The `node-key` provider: wraps under a key derived from this node's field key (SETTINGS_ENCRYPTION_KEY). */
export function nodeKeyProvider(subkey: () => Buffer = () => deriveNodeFieldSubkey('tdek.wrap.v1')): TenantKeyProvider {
  return {
    kind: 'node-key',
    shredsBackups: false,
    async wrap(slot, dek) {
      checkSlot(slot); checkDek(dek);
      return wrapUnderKek(NODE_WRAP_PREFIX, subkey(), slot, dek);
    },
    async unwrap(slot, wrapped) {
      checkSlot(slot);
      const dek = unwrapUnderKek(NODE_WRAP_PREFIX, subkey(), slot, wrapped);
      checkDek(dek);
      return dek;
    },
    async destroy(slot) {
      checkSlot(slot);   // nothing outside the row: the service clears the wrapped key
    },
  };
}

const SLOT_FILE_PREFIX = 'tdekslot1';
const FILE_WRAP_PREFIX = 'tdekf1';

/**
 * The `file` provider: one file per slot in `dir` (`<slot>.key`, mode 0600, the directory 0700), holding a random 32-byte slot key wrapped under the
 * region KEK read from `kekFile` (32 raw bytes or 64 hex chars; X4-7: or an age file sealed to the regional partner's identity, opened with
 * `kekAgeIdentityFile`, common/server/kek-source.ts). The data key is wrapped under the slot key, bound to the slot name.
 * The age identity file must be owner-only (group/other access refused, as the agent does). The KEK file itself is not mode-checked here: it never
 * was, and refusing it now would stop existing app deployments whose KEK file is group-readable; tightening that is a separate decision.
 */
export function fileKeyProvider(opts: { dir: string; kekFile: string; kekAgeIdentityFile?: string }): TenantKeyProvider {
  const dir = resolve(opts.dir);
  const checkPath = (path: string, label: string): string | null => (label === AGE_IDENTITY_FILE_LABEL ? ownerOnlyProblem(path, label) : null);
  const kek = (): Buffer => loadKekFile(opts.kekFile, { ageIdentityFile: opts.kekAgeIdentityFile, checkPath });
  const pathOf = (slot: string) => join(dir, `${slot}.key`);

  const readSlotKey = (slot: string): Buffer | null => {
    let text: string;
    try { text = readFileSync(pathOf(slot), 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    const key = unwrapUnderKek(SLOT_FILE_PREFIX, kek(), slot, text);
    if (key.length !== 32) throw new Error('tenant key provider: damaged slot file');
    return key;
  };

  const createSlotKey = (slot: string): Buffer => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    const body = wrapUnderKek(SLOT_FILE_PREFIX, kek(), slot, key);
    let fd: number;
    try {
      fd = openSync(pathOf(slot), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    } catch (e) {
      // Another process created the slot first: use its key.
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        const existing = readSlotKey(slot);
        if (existing) return existing;
      }
      throw e;
    }
    try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    syncDir(dir);
    return key;
  };

  return {
    kind: 'file',
    shredsBackups: true,
    async wrap(slot, dek) {
      checkSlot(slot); checkDek(dek);
      const slotKey = readSlotKey(slot) ?? createSlotKey(slot);
      return wrapUnderKek(FILE_WRAP_PREFIX, slotKey, slot, dek);
    },
    async unwrap(slot, wrapped) {
      checkSlot(slot);
      const slotKey = readSlotKey(slot);
      if (!slotKey) throw new TenantKeySlotGoneError(slot);
      const dek = unwrapUnderKek(FILE_WRAP_PREFIX, slotKey, slot, wrapped);
      checkDek(dek);
      return dek;
    },
    async destroy(slot) {
      checkSlot(slot);
      const file = pathOf(slot);
      let size: number;
      try { size = statSync(file).size; } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
      }
      // Overwrite before unlinking: on a plain filesystem the old blocks no longer hold the wrapped slot key (no guarantee on copy-on-write or
      // journalled media; the slot key is wrapped under the KEK anyway, so a stale block alone opens nothing without it).
      const fd = openSync(file, constants.O_WRONLY);
      try { writeSync(fd, randomBytes(Math.max(size, 1))); fsyncSync(fd); } finally { closeSync(fd); }
      unlinkSync(file);
      syncDir(dir);
    },
  };
}

function syncDir(dir: string): void {
  try {
    const fd = openSync(dir, constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* not every platform can fsync a directory */ }
}

/** The KMS / Vault adapters are interfaces so far (P7-TDEK): selecting one refuses every operation instead of silently using another key. */
export function unimplementedKeyProvider(kind: 'kms' | 'vault'): TenantKeyProvider {
  const refuse = async (): Promise<never> => {
    throw new Error(`TENANT_KEY_PROVIDER=${kind} is not implemented yet: use node-key or file`);
  };
  return { kind, shredsBackups: true, wrap: refuse, unwrap: refuse, destroy: refuse };
}

export interface TenantKeyProviderConfig {
  provider?: string;
  keystoreDir?: string;
  kekFile?: string;
  /** X4-7: the age identity file that opens an age-encrypted `kekFile`; when set, a cleartext KEK file is refused. */
  kekAgeIdentityFile?: string;
}

/** The provider the configuration names (`TENANT_KEY_PROVIDER`, default `node-key`); `file` needs both the key store directory and the KEK file. */
export function createTenantKeyProvider(config: TenantKeyProviderConfig): TenantKeyProvider {
  const kind = config.provider ?? 'node-key';
  switch (kind) {
    case 'node-key': return nodeKeyProvider();
    case 'file':
      if (!config.keystoreDir || !config.kekFile) throw new Error('TENANT_KEY_PROVIDER=file needs TENANT_KEYSTORE_DIR and TENANT_KEYSTORE_KEK_FILE');
      return fileKeyProvider({ dir: config.keystoreDir, kekFile: config.kekFile, kekAgeIdentityFile: config.kekAgeIdentityFile });
    case 'kms':
    case 'vault':
      return unimplementedKeyProvider(kind);
    default:
      throw new Error(`unknown TENANT_KEY_PROVIDER '${kind}'`);
  }
}
