// Application-UI dictionary for notification. Keys are module-prefixed; `en` is the
// source, other locales fill in. Collected into the generated ui-messages map.
import en from './en.json';
import tr from './tr.json';

export const dictionaries: Record<string, Record<string, string>> = { en, tr };
