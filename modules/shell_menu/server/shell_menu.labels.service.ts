import { getDataSource } from '@kuraykaraaslan-labs/db';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { loadModuleDictionaries } from '@kuraykaraaslan-labs/common/server/module-messages';
import { dictionaryLocales } from '@kuraykaraaslan-labs/common/server/dictionary-locales';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages';
import { flagCountry, getLanguage, isRtlLang, localeLabel } from '@kuraykaraaslan-labs/localization/server/languages';
import { SHELL_MENU_MODULE } from './shell_menu.keys';

// The menu's texts in every language (docs/phases/54-menu-editor, 02): which languages the editor shows, what is stored
// for the menu's own keys, what the built-in keys say, and translations to offer for a new English label.

export type EditorLanguage = { code: string; name: string; flag: string | null; rtl: boolean };

/** key → language → text. */
export type TextsByKey = Record<string, Record<string, string>>;

export type Suggestion = { text: string; source: string };

const ALPHA2 = /^[A-Z]{2}$/;

function languageOf(code: string): EditorLanguage {
  const country = flagCountry(code);
  return { code, name: getLanguage(code)?.label?.trim() || localeLabel(code) || code, flag: ALPHA2.test(country) ? country : null, rtl: isRtlLang(code) };
}

/** Keys that name a menu entry first, then the rest: what a suggestion prefers when several keys share an English text. */
function keyRank(key: string): number {
  if (key.includes('.menu.') || key.startsWith('app_shell.workspace.') || key.startsWith('app_shell.group.') || key.startsWith('shell_menu.')) return 0;
  if (key.includes('.title') || key.includes('.nav')) return 1;
  return 2;
}

type Dictionaries = Map<string, Record<string, Record<string, string>>>;
let dictionaries: Promise<Dictionaries> | null = null;

/** Every module's dictionaries, loaded once per process. */
function allDictionaries(): Promise<Dictionaries> {
  dictionaries ??= loadModuleDictionaries(moduleRegistry.getModules().map((m) => m.id))
    .then((entries) => new Map(entries.map(([module, dict]) => [module, dict as Record<string, Record<string, string>>])))
    .catch((err) => { dictionaries = null; throw err; });
  return dictionaries;
}

const moduleOfKey = (key: string) => key.slice(0, key.indexOf('.'));

export default class ShellMenuLabelsService {
  /**
   * The languages the editor offers a field for: English first, then every language the platform covers: a dictionary
   * in code, stored texts, or enabled for the root tenant. "Add language" in the editor offers the rest.
   */
  static async languages(): Promise<EditorLanguage[]> {
    const ds = await getDataSource();
    const stored: { locale: string }[] = await ds.query(`SELECT DISTINCT "locale" FROM "translations"`);
    const root = await resolveTenantLanguages(ROOT_TENANT_ID).then((r) => r.enabledLanguages).catch(() => [] as string[]);
    const codes = new Set<string>([...dictionaryLocales(), ...stored.map((r) => r.locale), ...root]);
    codes.delete('en');
    return [languageOf('en'), ...[...codes].filter((c) => getLanguage(c)).sort().map(languageOf)];
  }

  /** One language's entry (for a language the editor adds). */
  static language(code: string): EditorLanguage | null {
    return getLanguage(code) ? languageOf(code) : null;
  }

  /**
   * The stored texts of the menu's own keys, every language: the shared row, else the web row (the editor writes shared
   * rows; a web row a translator wrote in Platform → Translations wins for the web, so it is shown).
   */
  static async storedMenuTexts(): Promise<{ texts: TextsByKey; webOverrides: TextsByKey }> {
    const ds = await getDataSource();
    const rows: { key: string; locale: string; platform: string | null; value: string }[] = await ds.query(
      `SELECT "key", "locale", "platform", "value" FROM "translations" WHERE "module" = $1 AND ("platform" IS NULL OR "platform" = 'web')`,
      [SHELL_MENU_MODULE],
    );
    const texts: TextsByKey = {};
    const webOverrides: TextsByKey = {};
    for (const r of rows.filter((x) => x.platform === null)) (texts[r.key] ??= {})[r.locale] = r.value;
    for (const r of rows.filter((x) => x.platform === 'web')) {
      (texts[r.key] ??= {})[r.locale] = r.value;
      (webOverrides[r.key] ??= {})[r.locale] = r.value;
    }
    return { texts, webOverrides };
  }

  /** What the built-in keys say in every language: the dictionaries in code with the stored texts (shared or web) over them. */
  static async builtInTexts(keys: string[], languages: string[]): Promise<TextsByKey> {
    const dicts = await allDictionaries();
    const out: TextsByKey = {};
    for (const key of keys) {
      const dict = dicts.get(moduleOfKey(key)) ?? {};
      const entry: Record<string, string> = {};
      for (const lang of languages) {
        const text = dict[lang]?.[key];
        if (typeof text === 'string' && text) entry[lang] = text;
      }
      out[key] = entry;
    }
    if (!keys.length) return out;
    const ds = await getDataSource();
    const rows: { key: string; locale: string; value: string; platform: string | null }[] = await ds.query(
      `SELECT "key", "locale", "value", "platform" FROM "translations"
       WHERE "key" = ANY($1::varchar[]) AND ("platform" IS NULL OR "platform" = 'web') ORDER BY "platform" NULLS FIRST`,
      [keys],
    );
    for (const r of rows) (out[r.key] ??= {})[r.locale] = r.value;
    return out;
  }

  /**
   * Translations of an English text from keys that already have exactly that English (dictionaries in code and stored
   * texts), per language: the menu-like keys first (an item, workspace or group label), then page titles, then the rest.
   * `alternatives` lists a language whose candidates disagree.
   */
  static async suggest(english: string, languages: string[]): Promise<{ suggestions: Record<string, Suggestion>; alternatives: Record<string, Suggestion[]> }> {
    const wanted = english.trim();
    const suggestions: Record<string, Suggestion> = {};
    const alternatives: Record<string, Suggestion[]> = {};
    if (!wanted) return { suggestions, alternatives };
    const dicts = await allDictionaries();
    const candidates: string[] = [];
    for (const dict of dicts.values()) {
      for (const [key, text] of Object.entries(dict.en ?? {})) if (text === wanted) candidates.push(key);
    }
    const ds = await getDataSource();
    const storedEn: { key: string }[] = await ds.query(
      `SELECT DISTINCT "key" FROM "translations" WHERE "locale" = 'en' AND "value" = $1 AND ("platform" IS NULL OR "platform" = 'web') LIMIT 200`,
      [wanted],
    );
    for (const r of storedEn) if (!candidates.includes(r.key)) candidates.push(r.key);
    if (!candidates.length) return { suggestions, alternatives };
    candidates.sort((a, b) => keyRank(a) - keyRank(b) || a.localeCompare(b));
    const texts = await this.builtInTexts(candidates.slice(0, 200), languages);
    for (const lang of languages) {
      if (lang === 'en') continue;
      const seen = new Map<string, Suggestion>();
      for (const key of candidates) {
        const text = texts[key]?.[lang];
        if (text && !seen.has(text)) seen.set(text, { text, source: key });
      }
      const list = [...seen.values()];
      if (list.length) suggestions[lang] = list[0];
      if (list.length > 1) alternatives[lang] = list.slice(0, 5);
    }
    return { suggestions, alternatives };
  }
}
