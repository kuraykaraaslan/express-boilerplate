// data: per-(tenant,plugin) KV/document store.
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { PluginKv } from '../../entities/plugin_kv.entity';
import type { Json } from '../../../sdk/types';
import type { BrokerCtx } from '../broker.context';
import { getPluginRuntimePolicy } from '../../plugin_runtime.settings-policy';

// common.10: a plugin (or a holder of its broker token) must not be able to fill the shared table without bound.
/** The largest value one row holds, serialised (256 KiB). The operator may lower it (ROOT `pluginKvMaxValueKb`), never raise it. */
export const PLUGIN_KV_MAX_VALUE_BYTES = 256 * 1024;
/** The longest key and collection name. */
export const PLUGIN_KV_MAX_KEY_LENGTH = 512;
export const PLUGIN_KV_MAX_COLLECTION_LENGTH = 128;
const MAX_PAGE = 500;
const DEFAULT_PAGE = 100;

function boundedName(raw: unknown, max: number, what: string): string {
  const s = String(raw ?? '');
  if (!s || s.length > max) throw new Error(`invalid ${what}: 1 to ${max} characters`);
  return s;
}

/** A page size in 1..500 (a negative, zero, NaN or fractional one falls back to the default) and an offset >= 0. */
function page(opts?: { limit?: unknown; offset?: unknown }): { take: number; skip: number } {
  const l = Math.trunc(Number(opts?.limit ?? DEFAULT_PAGE));
  const o = Math.trunc(Number(opts?.offset ?? 0));
  return {
    take: Number.isFinite(l) && l >= 1 ? Math.min(l, MAX_PAGE) : DEFAULT_PAGE,
    skip: Number.isFinite(o) && o >= 0 ? o : 0,
  };
}

/** common.36: `%`, `_` and the escape character itself are literal in a "starts with" prefix (LIKE's default escape is `\`). */
export function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
}

export const data = {
  async get(ctx: BrokerCtx, collection: string, key: string): Promise<Json> {
    const row = await withTenantRepositoryFor(ctx.tenantId, PluginKv, (repo) => repo.findOne({
      where: { tenantId: ctx.tenantId, pluginId: ctx.pluginId, collection: String(collection), key: String(key) },
    }));
    return (row?.value as Json) ?? null;
  },
  async put(ctx: BrokerCtx, collection: string, key: string, value: Json): Promise<Json> {
    const c = boundedName(collection, PLUGIN_KV_MAX_COLLECTION_LENGTH, 'collection');
    const k = boundedName(key, PLUGIN_KV_MAX_KEY_LENGTH, 'key');
    const size = Buffer.byteLength(JSON.stringify(value ?? null) ?? 'null', 'utf8');
    const max = Math.min((await getPluginRuntimePolicy()).kvMaxValueBytes, PLUGIN_KV_MAX_VALUE_BYTES);
    if (size > max) throw new Error(`value too large: at most ${max} bytes serialised`);
    await withTenantRepositoryFor(ctx.tenantId, PluginKv, (repo) => repo.upsert(
      { tenantId: ctx.tenantId, pluginId: ctx.pluginId, collection: c, key: k, value: value as never },
      ['tenantId', 'pluginId', 'collection', 'key'],
    ));
    return null;
  },
  async delete(ctx: BrokerCtx, collection: string, key: string): Promise<Json> {
    await withTenantRepositoryFor(ctx.tenantId, PluginKv, (repo) => repo.delete({
      tenantId: ctx.tenantId, pluginId: ctx.pluginId, collection: String(collection), key: String(key),
    }));
    return null;
  },
  async list(ctx: BrokerCtx, collection: string, opts?: { prefix?: string; limit?: number; offset?: number; withValues?: boolean }): Promise<Json> {
    const rows = await withTenantRepositoryFor(ctx.tenantId, PluginKv, (repo) => {
      const qb = repo.createQueryBuilder('kv')
        .where('kv.tenantId = :t AND kv.pluginId = :p AND kv.collection = :c', { t: ctx.tenantId, p: ctx.pluginId, c: String(collection) });
      if (opts?.prefix) qb.andWhere('kv.key LIKE :pre', { pre: likePrefix(String(opts.prefix)) });
      const { take, skip } = page(opts);
      qb.orderBy('kv.key', 'ASC').take(take).skip(skip);
      return qb.getMany();
    });
    return rows.map((r) => (opts?.withValues ? { key: r.key, value: r.value as Json } : { key: r.key })) as Json;
  },
};
