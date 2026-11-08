// storage: scoped blob storage under plugins/<pluginId>/.
// `put` writes only into the plugin's own folder, and `getUrl` / `delete` accept only a key inside that folder in the
// calling tenant: a plugin cannot read or delete another plugin's objects (or the platform's plugin bundles) by key.
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import type { Json } from '../../../sdk/types';
import type { BrokerCtx } from '../broker.context';
import { getPluginRuntimePolicy } from '../../plugin_runtime.settings-policy';

/**
 * A relative path with no empty, `.` or `..` segment, no backslash and no percent-encoding (so it cannot climb out of
 * the folder it is joined to, whichever way a provider or a later decode reads it).
 */
function safeRelative(path: unknown): string {
  const p = String(path ?? '').replace(/^\/+/, '');
  if (!p || /[\\%\u0000-\u001f]/.test(p) || p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new Error('invalid storage path: a relative path without empty, . or .. segments, backslashes or percent-encoding');
  }
  return p;
}

/**
 * The key, if it lies in this plugin's folder for this tenant, always in its full form `<tenantId>/plugins/<pluginId>/…`;
 * throws otherwise. A bare `plugins/<pluginId>/…` (the folder without its tenant) is completed with the calling tenant:
 * storage refuses a key without its tenant prefix (F.storage.01), so passing it through would fail every such call.
 */
export function ownStorageKey(ctx: Pick<BrokerCtx, 'tenantId' | 'pluginId'>, key: unknown): string {
  const k = safeRelative(key);
  const folder = `plugins/${ctx.pluginId}/`;
  if (k.startsWith(`${ctx.tenantId}/${folder}`)) return k;
  if (k.startsWith(folder)) return `${ctx.tenantId}/${k}`;
  throw new Error(`storage key is outside this plugin's folder (${folder}): not allowed`);
}

/**
 * common.10: a presigned URL a plugin asks for lives at most seven days (the S3 SigV4 ceiling), whatever it passes. The operator may
 * lower it for the installation (ROOT `pluginPresignMaxSeconds`, plugin_runtime.settings-policy.ts), never raise it.
 */
export const PLUGIN_PRESIGN_MAX_SECONDS = 7 * 24 * 3600;
/**
 * common.10: the largest object a plugin writes in one call, the platform's own per-upload ceiling (10 MB). The operator may lower it
 * (ROOT `pluginUploadMaxMb`), never raise it.
 */
export const PLUGIN_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** The lifetime of one link: what the plugin asked for (900 s when nothing), at most `max` and never past the SigV4 ceiling. */
export function presignSeconds(raw: unknown, max: number = PLUGIN_PRESIGN_MAX_SECONDS): number {
  const cap = Math.min(max, PLUGIN_PRESIGN_MAX_SECONDS);
  const n = Math.trunc(Number(raw ?? 900));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, cap) : Math.min(900, cap);
}

export const storage = {
  async put(ctx: BrokerCtx, path: string, data: { base64: string; contentType?: string }): Promise<Json> {
    const base64 = String(data?.base64 ?? '');
    const max = Math.min((await getPluginRuntimePolicy()).uploadMaxBytes, PLUGIN_UPLOAD_MAX_BYTES);
    // Checked on the encoded length first, so an oversized payload is refused before it is decoded into memory.
    if (Math.floor((base64.length * 3) / 4) > max + 2) throw new Error(`storage object too large: at most ${max} bytes`);
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > max) throw new Error(`storage object too large: at most ${max} bytes`);
    const res = await StorageService.uploadServerBuffer(ctx.tenantId, {
      buffer, filename: safeRelative(path), contentType: data.contentType, folder: `plugins/${safeRelative(ctx.pluginId)}`,
    });
    return { key: res.key } as Json;
  },
  async getUrl(ctx: BrokerCtx, path: string, expiresSeconds?: number): Promise<Json> {
    const key = ownStorageKey(ctx, path);
    const { presignMaxSeconds } = await getPluginRuntimePolicy();
    return (await StorageService.getPresignedUrl(ctx.tenantId, key, presignSeconds(expiresSeconds, presignMaxSeconds))) as Json;
  },
  async delete(ctx: BrokerCtx, path: string): Promise<Json> {
    await StorageService.deleteFile(ctx.tenantId, { key: ownStorageKey(ctx, path) } as never);
    return null;
  },
};
