import type { EntityManager } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { TranslationEntrySchema, TranslationRefSchema } from './translation.dto';
import { deleteCache, messagesKey, versionsKey } from './translation.cache';
import { platformsAffectedBy, scopesAffectedBy } from './translation.platform';
import type { TranslationEntry, TranslationPlatform, TranslationRef } from './translation.types';

/** Rows per INSERT statement: 5 parameters each, well under PostgreSQL's 65535. */
const CHUNK = 500;

/**
 * `updatedAt` is clock_timestamp(), not now(): now() is the transaction START, so a
 * long transaction committing after a shorter one would stamp an older time and leave
 * max(updatedAt) unchanged. An unchanged value is skipped (WHERE ... IS DISTINCT FROM),
 * so re-saving the same text does not move the version and send every client to
 * download the module again.
 *
 * ON CONFLICT infers `uq_translations_scope_key`, which is NULLS NOT DISTINCT: a second
 * shared-platform row for the same key is a conflict, not a new row.
 */
const upsertSql = (count: number) => `
  INSERT INTO "translations" ("locale", "module", "platform", "key", "value", "createdAt", "updatedAt")
  VALUES ${Array.from({ length: count }, (_, i) => {
    const p = i * 5;
    return `($${p + 1}, $${p + 2}, $${p + 3}::varchar, $${p + 4}, $${p + 5}, clock_timestamp(), clock_timestamp())`;
  }).join(', ')}
  ON CONFLICT ("locale", "module", "platform", "key")
  DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = clock_timestamp()
  WHERE "translations"."value" IS DISTINCT FROM EXCLUDED."value"
  RETURNING "locale", "module", "platform"`;

// Many references in one statement: four parallel arrays unnested into rows. A CTE so the
// driver returns the deleted rows the way it returns a SELECT. NULL platform is matched
// with IS NOT DISTINCT FROM (a shared row).
const DELETE_SQL = `
  WITH refs AS (
    SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[]) AS r("locale", "module", "platform", "key")
  ), deleted AS (
    DELETE FROM "translations" t USING refs r
    WHERE t."locale" = r."locale" AND t."module" = r."module"
      AND t."platform" IS NOT DISTINCT FROM r."platform" AND t."key" = r."key"
    RETURNING t."locale", t."module", t."platform"
  )
  SELECT * FROM deleted`;

type Change = { locale: string; module: string; platform: TranslationPlatform | null };

/**
 * The cache entries a set of changed rows makes stale: the versions of every scope
 * that reads them and the bundles of every platform that reads them. A finite set, so
 * plain DEL, no SCAN.
 */
export function keysToInvalidate(changes: Change[]): string[] {
  const keys = new Set<string>();
  for (const c of changes) {
    for (const scope of scopesAffectedBy(c.platform)) keys.add(versionsKey(c.locale, scope));
    for (const platform of platformsAffectedBy(c.platform)) keys.add(messagesKey(c.locale, c.module, platform));
  }
  return [...keys];
}

const refId = (r: TranslationRef) => JSON.stringify([r.locale, r.module, r.platform, r.key]);

/** What a write inside the caller's transaction leaves to do once that transaction has committed. */
export type DeferredWrite = { count: number; afterCommit: () => Promise<void> };

function uniqueEntries(input: TranslationEntry[]): TranslationEntry[] {
  const unique = new Map<string, TranslationEntry>();
  for (const raw of input) {
    const entry = TranslationEntrySchema.parse(raw);
    unique.set(refId(entry), entry);
  }
  return [...unique.values()];
}

function uniqueRefs(input: TranslationRef[]): TranslationRef[] {
  const unique = new Map<string, TranslationRef>();
  for (const raw of input) {
    const ref = TranslationRefSchema.parse(raw);
    unique.set(refId(ref), ref);
  }
  return [...unique.values()];
}

async function upsertWith(manager: EntityManager, entries: TranslationEntry[]): Promise<Change[]> {
  const out: Change[] = [];
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const params = chunk.flatMap((e) => [e.locale, e.module, e.platform, e.key, e.value]);
    out.push(...((await manager.query(upsertSql(chunk.length), params)) as Change[]));
  }
  return out;
}

async function removeWith(manager: EntityManager, refs: TranslationRef[]): Promise<Change[]> {
  const out: Change[] = [];
  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const params = [chunk.map((r) => r.locale), chunk.map((r) => r.module), chunk.map((r) => r.platform), chunk.map((r) => r.key)];
    out.push(...((await manager.query(DELETE_SQL, params)) as Change[]));
  }
  return out;
}

export default class TranslationWriteService {
  /**
   * Store texts (insert or replace), in one transaction. The same text twice in the
   * input: the last one wins. Returns how many rows actually changed.
   */
  static async upsertMany(input: TranslationEntry[]): Promise<{ changed: number }> {
    const entries = uniqueEntries(input);
    if (entries.length === 0) return { changed: 0 };

    const ds = await getDataSource();
    const changes = await ds.transaction((manager) => upsertWith(manager, entries));

    // After the commit: a reader that refills the cache from here on reads the new rows.
    await deleteCache(keysToInvalidate(changes));
    return { changed: changes.length };
  }

  static async upsert(entry: TranslationEntry): Promise<{ changed: boolean }> {
    const { changed } = await this.upsertMany([entry]);
    return { changed: changed > 0 };
  }

  /**
   * Delete texts, in one transaction, CHUNK references per statement; the dictionary in
   * code shows through again. Returns how many rows were actually there.
   */
  static async removeMany(input: TranslationRef[]): Promise<{ removed: number }> {
    const refs = uniqueRefs(input);
    if (refs.length === 0) return { removed: 0 };

    const ds = await getDataSource();
    const changes = await ds.transaction((manager) => removeWith(manager, refs));

    await deleteCache(keysToInvalidate(changes));
    return { removed: changes.length };
  }

  /**
   * Store texts inside the CALLER's transaction (docs/phases/54-menu-editor, 02: a menu publish writes its spec and its
   * labels together). Nothing is cached-invalidated here: the caller runs `afterCommit` once its transaction has
   * committed, so a reader never refills the cache from rows that may still roll back. `count` = rows that changed.
   */
  static async upsertManyIn(manager: EntityManager, input: TranslationEntry[]): Promise<DeferredWrite> {
    const entries = uniqueEntries(input);
    const changes = entries.length === 0 ? [] : await upsertWith(manager, entries);
    return { count: changes.length, afterCommit: () => deleteCache(keysToInvalidate(changes)) };
  }

  /** Delete texts inside the caller's transaction; `afterCommit` as for `upsertManyIn`. `count` = rows that were there. */
  static async removeManyIn(manager: EntityManager, input: TranslationRef[]): Promise<DeferredWrite> {
    const refs = uniqueRefs(input);
    const changes = refs.length === 0 ? [] : await removeWith(manager, refs);
    return { count: changes.length, afterCommit: () => deleteCache(keysToInvalidate(changes)) };
  }

  /** Delete one text; the dictionary in code shows through again. */
  static async remove(input: TranslationRef): Promise<{ removed: boolean }> {
    const { removed } = await this.removeMany([input]);
    return { removed: removed > 0 };
  }
}
