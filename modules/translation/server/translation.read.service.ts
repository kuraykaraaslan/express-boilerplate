import { getDataSource } from '@kuraykaraaslan-labs/db';
import { singleFlight } from '@kuraykaraaslan-labs/redis';
import { LocaleSchema, ModuleIdSchema } from './translation.dto';
import { messagesKey, readCache, readCacheMany, versionsKey, writeCache } from './translation.cache';
import type {
  TranslationBundle, TranslationMessages, TranslationPlatform, TranslationScope, TranslationVersions,
} from './translation.types';

// Reads go to the PRIMARY, not getReadDataSource(): right after a write the cache is
// emptied, and the next reader refills it; a lagging replica would refill it with the
// text that was just replaced, for the whole TTL.

/**
 * The version of a set of rows: the latest `updatedAt` (microseconds since the epoch)
 * and the row count. An insert or an update moves the first part, a delete the second.
 * Opaque to clients, who only compare it for equality.
 */
export function formatVersion(maxUpdatedMicros: string | null, rows: number): string {
  return `${rows > 0 ? maxUpdatedMicros : '0'}-${rows}`;
}

/** The version of a module with no stored text. Never listed in a versions map. */
export const EMPTY_VERSION = formatVersion(null, 0);

// `updatedAt` as microseconds since the epoch. extract() returns numeric on PostgreSQL 14+, so the
// value is exact; both reads below use this one expression, so a bundle always carries the version
// the versions map announced for it.
const MICROS = (column: string) => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`;

// $2 NULL = scope `all`: every row, whatever its platform.
const VERSIONS_SQL = `
  SELECT "module", ${MICROS('max("updatedAt")')} AS "maxMicros", count(*)::int AS "rows"
  FROM "translations"
  WHERE "locale" = $1
    AND ($2::varchar IS NULL OR "platform" IS NULL OR "platform" = $2::varchar)
  GROUP BY "module"`;

const BUNDLE_SQL = `
  SELECT "key", "value", "platform", ${MICROS('"updatedAt"')} AS "micros"
  FROM "translations"
  WHERE "locale" = $1 AND "module" = $2
    AND ("platform" IS NULL OR "platform" = $3)`;

// Several modules in one read, for a page that shows texts of many (the admin layout).
const BUNDLES_SQL = `
  SELECT "module", "key", "value", "platform", ${MICROS('"updatedAt"')} AS "micros"
  FROM "translations"
  WHERE "locale" = $1 AND "module" = ANY($2::varchar[])
    AND ("platform" IS NULL OR "platform" = $3)`;

type VersionRow = { module: string; maxMicros: string; rows: number };
type BundleRow = { key: string; value: string; platform: TranslationPlatform | null; micros: string };

/** Read through the cache: hit → cached value; miss or Redis down → database, then refill. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await readCache<T>(key);
  if (hit !== null) return hit;
  // One database read per key per process, however many requests miss at once.
  return singleFlight(key, async () => {
    const value = await load();
    await writeCache(key, value);
    return value;
  });
}

export default class TranslationReadService {
  /**
   * module → version of its stored texts in `locale`, for `scope`. Only modules with at
   * least one row are listed, so an empty map means the database holds nothing there.
   */
  static async getVersions(locale: string, scope: TranslationScope): Promise<TranslationVersions> {
    const code = LocaleSchema.parse(locale);
    return cached(versionsKey(code, scope), async () => {
      const ds = await getDataSource();
      const rows: VersionRow[] = await ds.query(VERSIONS_SQL, [code, scope === 'all' ? null : scope]);
      const versions: TranslationVersions = {};
      for (const r of rows) versions[r.module] = formatVersion(r.maxMicros, r.rows);
      return versions;
    });
  }

  /**
   * One module's texts in `locale` for `platform`: the shared rows with that platform's
   * rows over them (a platform row wins on the same key). `version` equals what
   * `getVersions(locale, platform)` lists for the module, or EMPTY_VERSION.
   */
  static async getBundle(locale: string, module: string, platform: TranslationPlatform): Promise<TranslationBundle> {
    const code = LocaleSchema.parse(locale);
    const moduleId = ModuleIdSchema.parse(module);
    return cached(messagesKey(code, moduleId, platform), async () => {
      const ds = await getDataSource();
      const rows: BundleRow[] = await ds.query(BUNDLE_SQL, [code, moduleId, platform]);
      return toBundle(rows);
    });
  }

  /**
   * `getVersions` for several locales, keyed by the normalised code: one MGET, then a
   * database read per locale that missed. A locale the schema refuses is left out instead
   * of failing the rest.
   */
  static async getVersionsMany(locales: string[], scope: TranslationScope): Promise<Record<string, TranslationVersions>> {
    const codes = [...new Set(locales.map((l) => LocaleSchema.safeParse(l)).filter((r) => r.success).map((r) => r.data))];
    const hits = await readCacheMany<TranslationVersions>(codes.map((c) => versionsKey(c, scope)));
    const out: Record<string, TranslationVersions> = {};
    await Promise.all(codes.map(async (code, i) => {
      out[code] = hits[i] ?? await this.getVersions(code, scope);
    }));
    return out;
  }

  /**
   * `getBundle` for several modules of one locale: one MGET, then ONE database read for all
   * the modules that missed, each refilled under its own key. Every requested module is in
   * the result (EMPTY_VERSION when it has no rows).
   */
  static async getBundles(locale: string, modules: string[], platform: TranslationPlatform): Promise<Record<string, TranslationBundle>> {
    const code = LocaleSchema.parse(locale);
    const ids = [...new Set(modules.map((m) => ModuleIdSchema.parse(m)))];
    const hits = await readCacheMany<TranslationBundle>(ids.map((m) => messagesKey(code, m, platform)));
    const out: Record<string, TranslationBundle> = {};
    const missed: string[] = [];
    ids.forEach((m, i) => { if (hits[i]) out[m] = hits[i]!; else missed.push(m); });
    if (missed.length === 0) return out;

    const ds = await getDataSource();
    const rows: (BundleRow & { module: string })[] = await ds.query(BUNDLES_SQL, [code, missed, platform]);
    const byModule = new Map<string, BundleRow[]>(missed.map((m) => [m, []]));
    for (const r of rows) byModule.get(r.module)?.push(r);
    await Promise.all([...byModule].map(async ([m, rs]) => {
      out[m] = toBundle(rs);
      await writeCache(messagesKey(code, m, platform), out[m]);
    }));
    return out;
  }
}

/** Shared rows first, platform rows over them; the version over every row read. */
export function toBundle(rows: BundleRow[]): TranslationBundle {
  const messages: TranslationMessages = {};
  for (const r of rows) if (r.platform === null) messages[r.key] = r.value;
  for (const r of rows) if (r.platform !== null) messages[r.key] = r.value;
  let max: bigint | null = null;
  for (const r of rows) {
    const micros = BigInt(r.micros);
    if (max === null || micros > max) max = micros;
  }
  return { version: formatVersion(max === null ? null : max.toString(), rows.length), messages };
}
