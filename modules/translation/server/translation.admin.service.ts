import { getDataSource } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { loadModuleDictionaries } from '@kuraykaraaslan-labs/common/server/module-messages';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { baseLang, getLanguage } from '@kuraykaraaslan-labs/localization/server/languages';
import TranslationWriteService from './translation.write.service';
import { mobileEnglishOf, mobileModuleIds } from './translation.mobile-source';
import { runtimeEnglishOf, runtimeSources } from './translation.sources';
import { KeySchema } from './translation.dto';
import { toAdminPlatform, toRowPlatform, type AdminPlatform } from './translation.admin.dto';
import { TranslationMessages as M } from './translation.messages';
import type { TranslationEntry, TranslationMessages, TranslationPlatform, TranslationRef } from './translation.types';

// The system-level admin of the stored texts (root super-admin, GLOBAL scope; and the CLI import).
// Every text is system-wide, so every write here changes what every tenant reads: each one is
// audited. Reads and writes go to the primary, like the rest of the module.

/** Who made a change, for the audit trail: a user id, or null for the CLI. */
export type Actor = { userId: string | null; via: 'api' | 'cli' };

type StoredValue = { value: string; updatedAt: string };

/**
 * Where a key's English source is: the web dictionary, the mobile snapshot, both, a text a module created at run time
 * (`translation:source`, e.g. a menu label the sysadmin set), or none of them (a leftover).
 */
export type KeySource = 'web' | 'mobile' | 'both' | 'runtime' | null;

/** One key of a module in one language, with what each layer says. */
export type ModuleKey = {
  key: string;
  /** The English source: the web dictionary's, else the mobile snapshot's, else the run-time one; null when none has the key. */
  en: string | null;
  source: KeySource;
  /** The dictionary in code for this language; null when it does not ship the key. */
  code: string | null;
  /** The stored texts, per platform (`shared` = web and mobile). */
  stored: Partial<Record<AdminPlatform, StoredValue>>;
  /** Stored but in no English source (web, mobile or run time): a leftover to delete. */
  orphan: boolean;
};

export type ModuleSummary = {
  module: string;
  /** Keys in the English source, web and mobile together. */
  keys: number;
  /** Keys the dictionary in code ships for this language. */
  inCode: number;
  /** Stored rows, per platform. */
  stored: Record<AdminPlatform, number>;
};

export type ImportReport = {
  locale: string;
  platform: AdminPlatform;
  total: number;
  /** Counts of the valid keys: not stored yet / stored with another text / stored with this text. */
  new: number;
  changed: number;
  unchanged: number;
  /** Keys refused, with why (at most 100 listed; `invalidCount` has them all). */
  invalid: { key: string; reason: string }[];
  invalidCount: number;
  /** The modules the valid keys belong to. */
  modules: string[];
  /** True when the new and changed keys were stored. */
  written: boolean;
};

/** A language that exists (ISO 639), so a typo (`bgg`) never creates one. */
function assertLanguage(locale: string): void {
  if (!getLanguage(locale)) throw new AppError(M.UNKNOWN_LANGUAGE, 400, ErrorCode.VALIDATION_ERROR);
}

function assertModule(module: string): void {
  if (!moduleRegistry.getModule(module)) throw new AppError(M.UNKNOWN_MODULE, 404, ErrorCode.NOT_FOUND);
}

/** The English source and this language's dictionary of one module, from the code. */
async function dictionariesOf(module: string, locale: string): Promise<{ en: TranslationMessages; code: TranslationMessages }> {
  const [entry] = await loadModuleDictionaries([module]);
  const dict = entry?.[1] ?? {};
  const base = baseLang(locale);
  return { en: dict.en ?? {}, code: dict[base] ?? {} };
}

async function audit(action: string, actor: Actor, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID,
      actorId: actor.userId,
      action,
      resourceType: 'translation',
      resourceId,
      metadata: { ...metadata, via: actor.via },
    });
  } catch (err) {
    // The texts are stored; a lost audit row must not undo or fail that.
    Logger.warn(`[translation] audit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Distinct values, sorted: for audit metadata. */
const distinct = (values: string[]) => [...new Set(values)].sort();

export default class TranslationAdminService {
  /** Per module, for one language: how many keys the code has, ships for it, and how many rows are stored. */
  static async summary(locale: string): Promise<ModuleSummary[]> {
    assertLanguage(locale);
    const base = baseLang(locale);
    const ds = await getDataSource();
    const rows: { module: string; platform: TranslationPlatform | null; n: number }[] = await ds.query(
      `SELECT "module", "platform", count(*)::int AS "n" FROM "translations" WHERE "locale" = $1 GROUP BY "module", "platform"`,
      [locale],
    );
    const [dicts, runtime] = await Promise.all([
      loadModuleDictionaries(moduleRegistry.getModules().map((m) => m.id)),
      runtimeSources().catch(() => new Map<string, TranslationMessages>()),
    ]);
    const out = new Map<string, ModuleSummary>();
    const entry = (module: string) => {
      let s = out.get(module);
      if (!s) { s = { module, keys: 0, inCode: 0, stored: { shared: 0, web: 0, mobile: 0 } }; out.set(module, s); }
      return s;
    };
    const web = new Map(dicts.map(([module, dict]) => [module, dict]));
    // A mobile module this build does not register is left out: its keys cannot be opened or saved here.
    const mobileModules = mobileModuleIds().filter((id) => moduleRegistry.getModule(id));
    const runtimeModules = [...runtime.keys()].filter((id) => moduleRegistry.getModule(id));
    for (const moduleId of new Set([...web.keys(), ...mobileModules, ...runtimeModules])) {
      const dict = web.get(moduleId) ?? {};
      const s = entry(moduleId);
      s.keys = new Set([...Object.keys(dict.en ?? {}), ...Object.keys(mobileEnglishOf(moduleId)), ...Object.keys(runtime.get(moduleId) ?? {})]).size;
      s.inCode = Object.keys(dict[base] ?? {}).length;
    }
    for (const r of rows) entry(r.module).stored[toAdminPlatform(r.platform)] = r.n;
    return [...out.values()].sort((a, b) => a.module.localeCompare(b.module));
  }

  /**
   * Every key of one module in one language: the English source, the dictionary in code and the
   * stored texts side by side. Keys come from the English source (the web dictionary and the mobile
   * snapshot) plus any stored key (an orphan when neither source has it). `q` filters on the key and on every text, case-insensitive.
   */
  static async moduleKeys(locale: string, module: string, q?: string): Promise<ModuleKey[]> {
    assertLanguage(locale);
    assertModule(module);
    const { en, code } = await dictionariesOf(module, locale);
    const mobile = mobileEnglishOf(module);
    const runtime = await runtimeEnglishOf(module);
    const ds = await getDataSource();
    const rows: { key: string; platform: TranslationPlatform | null; value: string; updatedAt: Date }[] = await ds.query(
      `SELECT "key", "platform", "value", "updatedAt" FROM "translations" WHERE "locale" = $1 AND "module" = $2`,
      [locale, module],
    );
    const stored = new Map<string, ModuleKey['stored']>();
    for (const r of rows) {
      const s = stored.get(r.key) ?? {};
      s[toAdminPlatform(r.platform)] = { value: r.value, updatedAt: new Date(r.updatedAt).toISOString() };
      stored.set(r.key, s);
    }
    const needle = q?.toLowerCase();
    const sourceOf = (key: string): KeySource =>
      key in en ? (key in mobile ? 'both' : 'web') : key in mobile ? 'mobile' : key in runtime ? 'runtime' : null;
    return [...new Set([...Object.keys(en), ...Object.keys(mobile), ...Object.keys(runtime), ...stored.keys()])]
      .sort()
      .map((key): ModuleKey => {
        const source = sourceOf(key);
        return {
          key,
          en: en[key] ?? mobile[key] ?? runtime[key] ?? null,
          source,
          code: code[key] ?? null,
          stored: stored.get(key) ?? {},
          orphan: source === null,
        };
      })
      .filter((k) => !needle || [k.key, k.en, k.code, ...Object.values(k.stored).map((s) => s.value)]
        .some((t) => t?.toLowerCase().includes(needle)));
  }

  /** Store texts (one transaction); audited. Every language and module is checked first. */
  static async save(entries: (Omit<TranslationEntry, 'platform'> & { platform: AdminPlatform })[], actor: Actor): Promise<{ changed: number }> {
    for (const e of entries) { assertLanguage(e.locale); assertModule(e.module); }
    const rows = entries.map((e) => ({ ...e, platform: toRowPlatform(e.platform) }));
    const result = await TranslationWriteService.upsertMany(rows);
    if (result.changed > 0) {
      await audit('translation.texts.saved', actor, distinct(rows.map((r) => r.locale)).join(','), {
        count: rows.length, changed: result.changed,
        modules: distinct(rows.map((r) => r.module)), keys: rows.slice(0, 50).map((r) => r.key),
      });
    }
    return result;
  }

  /** Delete texts (one transaction); audited. */
  static async remove(refs: (Omit<TranslationRef, 'platform'> & { platform: AdminPlatform })[], actor: Actor): Promise<{ removed: number }> {
    const rows = refs.map((r) => ({ ...r, platform: toRowPlatform(r.platform) }));
    const result = await TranslationWriteService.removeMany(rows);
    if (result.removed > 0) {
      await audit('translation.texts.removed', actor, distinct(rows.map((r) => r.locale)).join(','), {
        count: rows.length, removed: result.removed,
        modules: distinct(rows.map((r) => r.module)), keys: rows.slice(0, 50).map((r) => r.key),
      });
    }
    return result;
  }

  /**
   * Import a flat `{ key: text }` map into one language and platform. The module is the key's
   * prefix. Each key is classified (new / changed / unchanged, or invalid: malformed key, unknown
   * module, empty text); only with `write` are the new and changed ones stored, in one
   * transaction, audited. Without it this is a preview and nothing is written.
   */
  static async importMessages(
    input: { locale: string; platform: AdminPlatform; messages: Record<string, string>; write: boolean },
    actor: Actor,
  ): Promise<ImportReport> {
    const { locale, platform, messages, write } = input;
    assertLanguage(locale);
    const rowPlatform = toRowPlatform(platform);

    const invalid: ImportReport['invalid'] = [];
    const valid: TranslationEntry[] = [];
    for (const [key, value] of Object.entries(messages)) {
      const moduleId = key.slice(0, key.indexOf('.'));
      if (!KeySchema.safeParse(key).success || !moduleId) invalid.push({ key, reason: 'invalid key' });
      else if (!moduleRegistry.getModule(moduleId)) invalid.push({ key, reason: `unknown module "${moduleId}"` });
      else if (value.length === 0) invalid.push({ key, reason: 'empty text' });
      else valid.push({ locale, module: moduleId, platform: rowPlatform, key, value });
    }

    const ds = await getDataSource();
    const existing: { key: string; value: string }[] = valid.length === 0 ? [] : await ds.query(
      `SELECT "key", "value" FROM "translations"
       WHERE "locale" = $1 AND "platform" IS NOT DISTINCT FROM $2::varchar AND "key" = ANY($3::varchar[])`,
      [locale, rowPlatform, valid.map((v) => v.key)],
    );
    const before = new Map(existing.map((r) => [r.key, r.value]));
    const toWrite = valid.filter((v) => before.get(v.key) !== v.value);
    const changed = toWrite.filter((v) => before.has(v.key)).length;

    const report: ImportReport = {
      locale, platform,
      total: Object.keys(messages).length,
      new: toWrite.length - changed,
      changed,
      unchanged: valid.length - toWrite.length,
      invalid: invalid.slice(0, 100),
      invalidCount: invalid.length,
      modules: distinct(valid.map((v) => v.module)),
      written: false,
    };
    if (!write || toWrite.length === 0) return report;

    await TranslationWriteService.upsertMany(toWrite);
    await audit('translation.texts.imported', actor, `${locale}:${platform}`, {
      total: report.total, new: report.new, changed: report.changed, unchanged: report.unchanged,
      invalid: report.invalidCount, modules: report.modules,
    });
    return { ...report, written: true };
  }

  /** The stored texts of one language and platform, as a flat map the import accepts back. */
  static async exportMessages(locale: string, platform: AdminPlatform): Promise<TranslationMessages> {
    assertLanguage(locale);
    const ds = await getDataSource();
    const rows: { key: string; value: string }[] = await ds.query(
      `SELECT "key", "value" FROM "translations"
       WHERE "locale" = $1 AND "platform" IS NOT DISTINCT FROM $2::varchar ORDER BY "key"`,
      [locale, toRowPlatform(platform)],
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
