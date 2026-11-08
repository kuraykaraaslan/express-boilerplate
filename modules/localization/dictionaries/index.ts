import en from './en.json';
import tr from './tr.json';
import zh from './zh.json';
import ru from './ru.json';
import de from './de.json';

/**
 * Application-UI dictionaries for the localization module.
 *
 * `zh` / `ru` / `de` are intentionally EMPTY: they exist so the locale is
 * *offered*, not because it is translated yet. `availableLocales()` in the
 * generated ui-messages map is the union of every module's locale keys, so one
 * module declaring a locale is enough to put it in the admin language picker —
 * and `pickLocaleMessages()` layers the locale over the English base with a
 * per-key fallback, so every untranslated string renders in English.
 *
 * To translate a module, run `node scripts/i18n/translate.mjs <moduleId> <lang>`:
 * it seeds `<lang>.json` from `en.json` and prints the still-English bundle to
 * feed the AI translator. Real per-module dictionaries then appear one by one —
 * no wiring change here or anywhere else is needed as they land.
 */
export const dictionaries: Record<string, Record<string, string>> = { en, tr, zh, ru, de };
