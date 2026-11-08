import crypto from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { getLanguage } from '@kuraykaraaslan-labs/localization/server/languages';
import TranslationWriteService, { type DeferredWrite } from '@kuraykaraaslan-labs/translation/server/translation.write.service';
import { ShellMenu, type PendingLabels } from './entities/shell_menu.entity';
import { ShellMenuRevision, type LabelSnapshot } from './entities/shell_menu_revision.entity';
import { MenuSpecSchema, type MenuSpec } from './shell_menu.schema';
import { SHELL_MENU_MODULE, specLabelSources } from './shell_menu.keys';
import { checkLinkTargets, checkSpecNames } from './shell_menu.catalog.service';
import { bumpMenuVersion } from './shell_menu.read.service';
import { diffSpecs, type SpecDiff } from './shell_menu.diff';
import { MENU_FILE_FORMAT, ShellMenuMessages as M } from './shell_menu.messages';

// The menu's writes (docs/phases/54-menu-editor, 03): the draft, publish, restore, import and export. A publish, a
// restore and an import each write the published menu, a revision and the label texts in ONE transaction, then bump
// the version every process reads the menu by. Audited on the root tenant; a lost audit row never undoes a write.

export type Actor = { userId: string | null; via: 'ui' | 'cli' };

export type MenuFile = { format: typeof MENU_FILE_FORMAT; spec: MenuSpec; labels: LabelSnapshot; revision?: number; exportedAt?: string };

export type Problems = { errors: string[]; warnings: string[] };

export type DraftView = { spec: MenuSpec; labels: PendingLabels; etag: string; baseRevision: number; updatedAt: string; updatedBy: string | null };
export type PublishedView = { spec: MenuSpec; revision: number; updatedAt: string; updatedBy: string | null };

const LABEL_TEXT_MAX = 60;

const newEtag = () => crypto.randomUUID();

async function audit(action: string, actor: Actor, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorId: actor.userId, action, resourceType: 'shell_menu', resourceId,
      metadata: { ...metadata, via: actor.via },
    });
  } catch (err) {
    Logger.warn(`[shell_menu] audit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validationError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(message, 400, ErrorCode.VALIDATION_ERROR, details ? { details } : undefined);
}

function parseSpec(input: unknown): MenuSpec {
  const r = MenuSpecSchema.safeParse(input);
  if (!r.success) throw validationError('The menu is not valid', { issues: r.error.issues.slice(0, 50).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data as MenuSpec;
}

/** Pending labels: own keys only, real languages, English excluded (it lives in the spec), short texts or null. */
function parseLabels(input: unknown, allowNull: boolean): PendingLabels {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('Labels must be an object');
  const out: PendingLabels = {};
  let count = 0;
  for (const [key, byLang] of Object.entries(input as Record<string, unknown>)) {
    if (!/^shell_menu\.(item|workspace|group|link)\.[A-Za-z0-9_-]{1,80}$/.test(key)) throw validationError(`Not a menu label key: ${key.slice(0, 100)}`);
    if (!byLang || typeof byLang !== 'object' || Array.isArray(byLang)) throw validationError(`Labels of ${key} must be an object`);
    const entry: Record<string, string | null> = {};
    for (const [lang, text] of Object.entries(byLang as Record<string, unknown>)) {
      if (lang === 'en') continue;
      if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang) || !getLanguage(lang)) throw validationError(`${M.UNKNOWN_LANGUAGE}: ${lang.slice(0, 20)}`);
      if (text === null && allowNull) { entry[lang] = null; continue; }
      if (typeof text !== 'string') throw validationError(`The ${lang} text of ${key} must be a text`);
      const trimmed = text.trim();
      if (trimmed.length > LABEL_TEXT_MAX) throw validationError(`The ${lang} text of ${key} is longer than ${LABEL_TEXT_MAX} characters`);
      entry[lang] = trimmed ? trimmed : (allowNull ? null : '');
      if (entry[lang] === '') delete entry[lang];
      if (++count > 20000) throw validationError('Too many label texts');
    }
    out[key] = entry;
  }
  return out;
}

/** Every problem of a spec: shape is already checked; names, icons and contributed targets here. */
export async function specProblems(spec: MenuSpec): Promise<Problems> {
  const names = checkSpecNames(spec);
  const targets = await checkLinkTargets(spec);
  return { errors: [...names.errors, ...targets.errors], warnings: [...names.warnings, ...targets.warnings] };
}

async function lockRow(manager: EntityManager, state: 'draft' | 'published'): Promise<ShellMenu | null> {
  return manager.getRepository(ShellMenu).createQueryBuilder('m').setLock('pessimistic_write').where('m.state = :state', { state }).getOne();
}

async function nextRevision(manager: EntityManager): Promise<number> {
  const [row] = (await manager.query(`SELECT COALESCE(MAX("revision"), 0)::int AS "max" FROM "shell_menu_revisions"`)) as { max: number }[];
  return (row?.max ?? 0) + 1;
}

/** The stored shared texts of `keys`, every language. */
async function storedTexts(manager: EntityManager, keys: string[]): Promise<LabelSnapshot> {
  if (!keys.length) return {};
  const rows = (await manager.query(
    `SELECT "key", "locale", "value" FROM "translations" WHERE "module" = $1 AND "platform" IS NULL AND "key" = ANY($2::varchar[])`,
    [SHELL_MENU_MODULE, keys],
  )) as { key: string; locale: string; value: string }[];
  const out: LabelSnapshot = {};
  for (const r of rows) (out[r.key] ??= {})[r.locale] = r.value;
  return out;
}

/** Delete every stored text (any platform) of keys the menu no longer has. */
async function removeKeys(manager: EntityManager, keys: string[]): Promise<DeferredWrite | null> {
  if (!keys.length) return null;
  const rows = (await manager.query(
    `SELECT "key", "locale", "platform" FROM "translations" WHERE "module" = $1 AND "key" = ANY($2::varchar[])`,
    [SHELL_MENU_MODULE, keys],
  )) as { key: string; locale: string; platform: 'web' | 'mobile' | null }[];
  if (!rows.length) return null;
  return TranslationWriteService.removeManyIn(manager, rows.map((r) => ({ locale: r.locale, module: SHELL_MENU_MODULE, platform: r.platform, key: r.key })));
}

/**
 * Make the stored shared texts of the spec's keys what `wanted` says: upsert the given texts, delete a language set to
 * null (`exact`: also every stored language `wanted` does not name), and delete the keys of `previous` the spec dropped.
 */
async function writeLabels(
  manager: EntityManager, spec: MenuSpec, previous: MenuSpec | null, wanted: Record<string, Record<string, string | null>>, exact: boolean,
): Promise<{ deferred: DeferredWrite[]; written: number; removed: number }> {
  const keys = [...specLabelSources(spec).keys()];
  const keySet = new Set(keys);
  const deferred: DeferredWrite[] = [];
  const upserts: { locale: string; module: string; platform: null; key: string; value: string }[] = [];
  const removals: { locale: string; module: string; platform: null; key: string }[] = [];
  const current = await storedTexts(manager, keys);
  for (const key of keys) {
    const byLang = wanted[key] ?? {};
    for (const [lang, text] of Object.entries(byLang)) {
      if (lang === 'en') continue;
      if (text === null) { if (current[key]?.[lang] !== undefined) removals.push({ locale: lang, module: SHELL_MENU_MODULE, platform: null, key }); }
      else upserts.push({ locale: lang, module: SHELL_MENU_MODULE, platform: null, key, value: text });
    }
    if (exact) {
      for (const lang of Object.keys(current[key] ?? {})) {
        if (!(lang in byLang)) removals.push({ locale: lang, module: SHELL_MENU_MODULE, platform: null, key });
      }
    }
  }
  if (upserts.length) deferred.push(await TranslationWriteService.upsertManyIn(manager, upserts));
  if (removals.length) deferred.push(await TranslationWriteService.removeManyIn(manager, removals));
  const dropped = previous ? [...specLabelSources(previous).keys()].filter((k) => !keySet.has(k)) : [];
  const gone = await removeKeys(manager, dropped);
  if (gone) deferred.push(gone);
  return { deferred, written: upserts.length, removed: removals.length + (gone?.count ?? 0) };
}

/** Write a new published state: the row, a revision with the label snapshot. Inside the caller's transaction. */
async function writePublished(
  manager: EntityManager, spec: MenuSpec, action: 'publish' | 'restore' | 'import', actor: Actor, note: string | null,
): Promise<number> {
  const revision = await nextRevision(manager);
  const keys = [...specLabelSources(spec).keys()];
  const labelTexts = await storedTexts(manager, keys);
  const repo = manager.getRepository(ShellMenu);
  const existing = await repo.findOne({ where: { state: 'published' } });
  if (existing) {
    await repo.update({ menuId: existing.menuId }, { spec, revision, etag: newEtag(), updatedBy: actor.userId, labels: null });
  } else {
    await repo.insert({ state: 'published', spec, revision, etag: newEtag(), updatedBy: actor.userId, labels: null });
  }
  await manager.getRepository(ShellMenuRevision).insert({ revision, spec, labelTexts, action, note, via: actor.via, createdBy: actor.userId });
  return revision;
}

async function afterCommit(deferred: DeferredWrite[], revision: number): Promise<void> {
  for (const d of deferred) {
    try { await d.afterCommit(); } catch (err) { Logger.warn(`[shell_menu] label cache refresh failed: ${err instanceof Error ? err.message : String(err)}`); }
  }
  await bumpMenuVersion(revision);
}

const toDraftView = (row: ShellMenu): DraftView => ({
  spec: row.spec, labels: row.labels ?? {}, etag: row.etag, baseRevision: row.revision,
  updatedAt: new Date(row.updatedAt).toISOString(), updatedBy: row.updatedBy,
});
const toPublishedView = (row: ShellMenu): PublishedView => ({
  spec: row.spec, revision: row.revision, updatedAt: new Date(row.updatedAt).toISOString(), updatedBy: row.updatedBy,
});

export default class ShellMenuService {
  /** The published menu and the draft, with the problems of each. */
  static async state(): Promise<{ published: (PublishedView & Problems) | null; draft: (DraftView & Problems) | null; storedLabels: LabelSnapshot }> {
    const ds = await getDataSource();
    const rows = await ds.getRepository(ShellMenu).find();
    const published = rows.find((r) => r.state === 'published');
    const draft = rows.find((r) => r.state === 'draft');
    const keys = new Set<string>([
      ...(published ? specLabelSources(published.spec).keys() : []),
      ...(draft ? specLabelSources(draft.spec).keys() : []),
    ]);
    const storedLabels = await storedTexts(ds.manager, [...keys]);
    return {
      published: published ? { ...toPublishedView(published), ...(await specProblems(published.spec)) } : null,
      draft: draft ? { ...toDraftView(draft), ...(await specProblems(draft.spec)) } : null,
      storedLabels,
    };
  }

  /**
   * Save the whole draft. `ifMatch` is the etag the editor last saw (`null` = "there was no draft"); another editor's
   * save in between is a 409 carrying the current draft. Shape errors refuse the save; name problems are returned.
   */
  static async saveDraft(input: { spec: unknown; labels?: unknown }, ifMatch: string | null, actor: Actor): Promise<DraftView & Problems> {
    const spec = parseSpec(input.spec);
    const labels = parseLabels(input.labels, true);
    const ds = await getDataSource();
    const row = await ds.transaction(async (manager) => {
      const draft = await lockRow(manager, 'draft');
      const published = await lockRow(manager, 'published');
      if ((draft?.etag ?? null) !== ifMatch) {
        throw new AppError(M.DRAFT_CHANGED, 409, ErrorCode.CONFLICT, { details: { draft: draft ? toDraftView(draft) : null } });
      }
      const repo = manager.getRepository(ShellMenu);
      const etag = newEtag();
      if (draft) {
        await repo.update({ menuId: draft.menuId }, { spec, labels, etag, updatedBy: actor.userId });
        return { ...draft, spec, labels, etag, updatedBy: actor.userId, updatedAt: new Date() };
      }
      const created = repo.create({ state: 'draft', spec, labels, etag, revision: published?.revision ?? 0, updatedBy: actor.userId });
      return repo.save(created);
    });
    return { ...toDraftView(row as ShellMenu), ...(await specProblems(spec)) };
  }

  /** Throw the draft away (the published menu is untouched). */
  static async discardDraft(actor: Actor): Promise<{ discarded: boolean }> {
    const ds = await getDataSource();
    const result = await ds.getRepository(ShellMenu).delete({ state: 'draft' });
    const discarded = (result.affected ?? 0) > 0;
    if (discarded) await audit('shell_menu.draft.discarded', actor, 'draft', {});
    return { discarded };
  }

  /** Publish the draft: one transaction for the menu, its revision and its label texts; 409 when the base moved. */
  static async publish(input: { baseRevision?: number; note?: string | null }, actor: Actor): Promise<{ revision: number; written: number; removed: number }> {
    const ds = await getDataSource();
    let deferred: DeferredWrite[] = [];
    let counts = { written: 0, removed: 0 };
    let warnings: string[] = [];
    const revision = await ds.transaction(async (manager) => {
      const draft = await lockRow(manager, 'draft');
      if (!draft) throw new AppError(M.NO_DRAFT, 404, ErrorCode.NOT_FOUND);
      const published = await lockRow(manager, 'published');
      const base = published?.revision ?? 0;
      if (draft.revision !== base || (input.baseRevision !== undefined && input.baseRevision !== base)) {
        throw new AppError(M.PUBLISHED_CHANGED, 409, ErrorCode.CONFLICT, { details: { publishedRevision: base } });
      }
      const spec = parseSpec(draft.spec);
      const problems = await specProblems(spec);
      if (problems.errors.length) throw validationError(M.DRAFT_HAS_ERRORS, { errors: problems.errors.slice(0, 50) });
      warnings = problems.warnings;
      const labels = await writeLabels(manager, spec, published?.spec ?? null, draft.labels ?? {}, false);
      deferred = labels.deferred;
      counts = { written: labels.written, removed: labels.removed };
      const rev = await writePublished(manager, spec, 'publish', actor, input.note?.trim().slice(0, 280) || null);
      await manager.getRepository(ShellMenu).delete({ menuId: draft.menuId });
      return rev;
    });
    await afterCommit(deferred, revision);
    await audit('shell_menu.published', actor, String(revision), { ...counts, warnings: warnings.length });
    return { revision, ...counts };
  }

  /** Publish an earlier revision again (its menu and its label texts) as a new revision. The draft stays. */
  static async restore(revisionNo: number, actor: Actor): Promise<{ revision: number }> {
    const ds = await getDataSource();
    let deferred: DeferredWrite[] = [];
    const revision = await ds.transaction(async (manager) => {
      const source = await manager.getRepository(ShellMenuRevision).findOne({ where: { revision: revisionNo } });
      if (!source) throw new AppError(M.REVISION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      const published = await lockRow(manager, 'published');
      const spec = parseSpec(source.spec);
      const labels = await writeLabels(manager, spec, published?.spec ?? null, source.labelTexts ?? {}, true);
      deferred = labels.deferred;
      return writePublished(manager, spec, 'restore', actor, `restored revision ${revisionNo}`);
    });
    await afterCommit(deferred, revision);
    await audit('shell_menu.restored', actor, String(revision), { from: revisionNo });
    return { revision };
  }

  /** The published menu as one file, every language of its own texts. */
  static async exportFile(): Promise<MenuFile> {
    const ds = await getDataSource();
    const published = await ds.getRepository(ShellMenu).findOne({ where: { state: 'published' } });
    const spec = published?.spec ?? {};
    const labels = await storedTexts(ds.manager, [...specLabelSources(spec).keys()]);
    return { format: MENU_FILE_FORMAT, spec, labels, revision: published?.revision ?? 0, exportedAt: new Date().toISOString() };
  }

  /** Read and check a menu file: its spec, its labels, its problems. */
  static async readFile(input: unknown): Promise<{ spec: MenuSpec; labels: LabelSnapshot; problems: Problems }> {
    if (!input || typeof input !== 'object' || (input as { format?: unknown }).format !== MENU_FILE_FORMAT) throw validationError(M.INVALID_FILE);
    const file = input as { spec?: unknown; labels?: unknown };
    const spec = parseSpec(file.spec ?? {});
    const labels = parseLabels(file.labels, false) as LabelSnapshot;
    return { spec, labels, problems: await specProblems(spec) };
  }

  /**
   * Import a menu file. `target: 'draft'` replaces the draft (`replace` needed when one exists); `target: 'publish'`
   * publishes it as a new revision (`replace` needed when a menu is published). Without `write` nothing is stored and
   * the answer says what would change.
   */
  static async importFile(
    input: { file: unknown; target: 'draft' | 'publish'; write: boolean; replace: boolean; note?: string | null },
    actor: Actor,
  ): Promise<{ preview: ImportPreview; written: boolean; revision?: number }> {
    const { spec, labels, problems } = await this.readFile(input.file);
    const ds = await getDataSource();
    const published = await ds.getRepository(ShellMenu).findOne({ where: { state: 'published' } });
    const draft = await ds.getRepository(ShellMenu).findOne({ where: { state: 'draft' } });
    const against = input.target === 'draft' ? draft?.spec ?? published?.spec ?? {} : published?.spec ?? {};
    const preview = { ...diffSpecs(against, spec), labels: countLabels(labels), ...problems };
    if (!input.write) return { preview, written: false };
    if (problems.errors.length) throw validationError(M.DRAFT_HAS_ERRORS, { errors: problems.errors.slice(0, 50) });

    if (input.target === 'draft') {
      if (draft && !input.replace) throw new AppError(M.DRAFT_CHANGED, 409, ErrorCode.CONFLICT, { details: { draft: toDraftView(draft) } });
      await this.saveDraft({ spec, labels }, draft?.etag ?? null, actor);
      await audit('shell_menu.imported', actor, 'draft', { target: 'draft', ...preview.labels.total });
      return { preview, written: true };
    }

    if (published && !input.replace) throw new AppError(M.ALREADY_PUBLISHED, 409, ErrorCode.CONFLICT);
    let deferred: DeferredWrite[] = [];
    const revision = await ds.transaction(async (manager) => {
      const current = await lockRow(manager, 'published');
      const written = await writeLabels(manager, spec, current?.spec ?? null, labels, true);
      deferred = written.deferred;
      return writePublished(manager, spec, 'import', actor, input.note?.trim().slice(0, 280) || null);
    });
    await afterCommit(deferred, revision);
    await audit('shell_menu.imported', actor, String(revision), { target: 'publish', languages: Object.keys(preview.labels.byLanguage) });
    return { preview, written: true, revision };
  }

  static async revisions(page = 1, pageSize = 25): Promise<{ items: RevisionSummary[]; total: number }> {
    const ds = await getDataSource();
    const [rows, total] = await ds.getRepository(ShellMenuRevision).findAndCount({
      order: { revision: 'DESC' }, skip: (page - 1) * pageSize, take: pageSize,
      select: ['revision', 'action', 'note', 'via', 'createdBy', 'createdAt'],
    });
    return { items: rows.map((r) => ({ revision: r.revision, action: r.action, note: r.note, via: r.via, createdBy: r.createdBy, createdAt: new Date(r.createdAt).toISOString() })), total };
  }

  static async revision(revisionNo: number): Promise<{ revision: number; spec: MenuSpec; labelTexts: LabelSnapshot; action: string; note: string | null; createdAt: string }> {
    const ds = await getDataSource();
    const r = await ds.getRepository(ShellMenuRevision).findOne({ where: { revision: revisionNo } });
    if (!r) throw new AppError(M.REVISION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return { revision: r.revision, spec: r.spec, labelTexts: r.labelTexts, action: r.action, note: r.note, createdAt: new Date(r.createdAt).toISOString() };
  }
}

export type RevisionSummary = { revision: number; action: string; note: string | null; via: string; createdBy: string | null; createdAt: string };

export type ImportPreview = SpecDiff & { labels: LabelCounts } & Problems;
export type LabelCounts = { total: { keys: number; texts: number }; byLanguage: Record<string, number> };

function countLabels(labels: LabelSnapshot): LabelCounts {
  const byLanguage: Record<string, number> = {};
  let texts = 0;
  for (const byLang of Object.values(labels)) {
    for (const lang of Object.keys(byLang)) { byLanguage[lang] = (byLanguage[lang] ?? 0) + 1; texts++; }
  }
  return { total: { keys: Object.keys(labels).length, texts }, byLanguage };
}
