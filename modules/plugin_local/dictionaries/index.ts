// Application-UI dictionary for plugin_local. Keys are module-prefixed; `en` is
// the source (extracted from the t() fallbacks), other locales fill in.
import en from './en.json';
import tr from './tr.json';

export const dictionaries: Record<string, Record<string, string>> = { en, tr };
