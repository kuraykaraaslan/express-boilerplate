/**
 * Texts a module creates at run time (docs/phases/54-menu-editor, D54-8): the sidebar's renamed items, added workspaces
 * and custom links have no `t('key', 'English')` in code, so no `en.json` carries them. A module that has such texts
 * contributes them to `translation:source` with their English, and Platform → Translations lists, counts, exports and
 * imports them like any key instead of flagging their stored texts as leftovers. `translation` imports nothing of the
 * contributor; the contributor imports only this contract.
 */
export const TRANSLATION_SOURCE_POINT = 'translation:source';

export interface RuntimeTextSource {
  /** Must be the contributing module's own id: a module names only keys of its own. */
  module: string;
  /** `<module>.<area>.<slug>`, the translation key rule. */
  key: string;
  /** The English source text. */
  en: string;
}

export interface TranslationSourceProvider {
  /** Every run-time key of the module with its English. Return [] when there is none. */
  sources(): Promise<RuntimeTextSource[]>;
}
