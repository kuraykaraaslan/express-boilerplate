// The mobile app's English source, as the snapshot `npm run translation:sync-mobile` copies into
// data/: the admin view merges it with the web dictionaries, so a key only the mobile app has is
// listed (and is not a leftover). The mobile app's own bundled translations are not copied.
import snapshot from '../data/mobile.en.json';
import meta from '../data/mobile.en.meta.json';
import type { TranslationMessages } from './translation.types';

/** Which mobile commit the snapshot was taken from, when, and how many keys it holds. */
export type MobileSourceMeta = { commit: string; date: string; keyCount: number };

export const mobileSourceMeta: MobileSourceMeta = meta;

let byModule: Map<string, TranslationMessages> | undefined;

/** The snapshot split by module (the key's prefix), built once. */
function modules(): Map<string, TranslationMessages> {
  if (byModule) return byModule;
  byModule = new Map();
  for (const [key, value] of Object.entries(snapshot as TranslationMessages)) {
    const id = key.slice(0, key.indexOf('.'));
    const dict = byModule.get(id) ?? {};
    dict[key] = value;
    byModule.set(id, dict);
  }
  return byModule;
}

/** The mobile English texts of one module; empty when the app has none. */
export const mobileEnglishOf = (module: string): TranslationMessages => modules().get(module) ?? {};

/** The ids of the modules the mobile app has English texts for. */
export const mobileModuleIds = (): string[] => [...modules().keys()];

/** Whether the mobile app reads `module` at all: the scope of the mobile language list and bundles. */
export const isMobileModule = (module: string): boolean => modules().has(module);
