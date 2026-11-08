// localfs: HOST-SIDE disk I/O for the local disk storage plugin (`@local/storage`, key `local` of storage:provider). A V8
// isolate has no filesystem, so the plugin hands the object here and the broker writes it, the same split as `smtp` (the
// isolate has no sockets). The plugin chooses nothing about WHERE: the base directory and the free-space floor are the
// platform's (`storageLocalDir` / `storageLocalMinFreeMb`, read from the ROOT tenant only, storage.local.config.ts), and a
// key must lie in the calling tenant's own subtree (`<tenantId>/…`). Every path check (no `.`/`..`/empty segment, no
// separator or control character, real path inside the base directory, symlinks never followed out of it) and the atomic
// write are storage's own (storage.local.fs.ts), shared with the reads the host does for the same objects.
//
// A grant of `localfs` is the same trust as a bucket key: the plugin can overwrite or delete any object of the tenant it runs
// for. The operator grants it (plugin_local approval, or the marketplace review), never a manifest on its own.
import { getLocalStorageConfig } from '@kuraykaraaslan-labs/storage/server/storage.local.config';
import { deleteObject, keySegments, writeObject } from '@kuraykaraaslan-labs/storage/server/storage.local.fs';
import type { Json } from '../../../sdk/types';
import type { BrokerCtx } from '../broker.context';

/**
 * The largest object one `localfs.write` takes: the plugin-host's run body (16 MB), which already bounds what the isolate can
 * hand over. Checked on the encoded length first, so an oversized payload is refused before it is decoded into memory.
 */
export const LOCALFS_WRITE_MAX_BYTES = 16 * 1024 * 1024;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** The key, if it is a well-formed object key in the calling tenant's subtree; throws otherwise. */
export function ownLocalKey(ctx: Pick<BrokerCtx, 'tenantId'>, key: unknown): string {
  const segs = keySegments(key);
  if (segs[0] !== ctx.tenantId) throw new Error('localfs key is outside the calling tenant: not allowed');
  return key as string;
}

export const localfs = {
  async write(ctx: BrokerCtx, key: string, contentBase64: string): Promise<Json> {
    const k = ownLocalKey(ctx, key);
    const b64 = typeof contentBase64 === 'string' ? contentBase64 : '';
    if (Math.floor((b64.length * 3) / 4) > LOCALFS_WRITE_MAX_BYTES + 2) throw new Error(`localfs object too large: at most ${LOCALFS_WRITE_MAX_BYTES} bytes`);
    // Buffer.from would silently drop junk and store something other than what was sent.
    if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) throw new Error('localfs content must be base64');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > LOCALFS_WRITE_MAX_BYTES) throw new Error(`localfs object too large: at most ${LOCALFS_WRITE_MAX_BYTES} bytes`);
    const { dir, minFreeBytes } = await getLocalStorageConfig();
    await writeObject(dir, k, bytes, minFreeBytes);
    return { ok: true, size: bytes.length };
  },
  async delete(ctx: BrokerCtx, key: string): Promise<Json> {
    const k = ownLocalKey(ctx, key);
    const { dir } = await getLocalStorageConfig();
    await deleteObject(dir, k);
    return { ok: true };
  },
};
