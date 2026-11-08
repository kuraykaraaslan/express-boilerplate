// Application-UI dictionary for shell_menu (Platform → Menu, the menu editor). Keys are module-prefixed; `en` is the
// source (generated from t('key','English') defaults), other locales fill in. Collected into the app-layer
// _generated/ui-messages.ts aggregator by the registry. The menu's own labels (`shell_menu.item.*`, `.workspace.*`,
// `.group.*`, `.link.*`) are not here: their English lives in the stored menu, their other languages in `translations`.
import en from './en.json';
import tr from './tr.json';

export const dictionaries: Record<string, Record<string, string>> = { en, tr };
