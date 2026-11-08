import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { translationSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/translation.source';
import { KeySchema } from './translation.dto';
import { TRANSLATION_SOURCE_POINT, type RuntimeTextSource, type TranslationSourceProvider } from './translation.sources.types';
import type { TranslationMessages } from './translation.types';

// The host side of `translation:source` (D54-8): the English of the keys modules create at run time, merged into the
// admin screen's English source beside the web dictionaries and the mobile snapshot.

/** Per provider; a menu has a few hundred texts at most. */
const MAX_PER_PROVIDER = 5000;
const MAX_TEXT = 2000;

/**
 * module → { key → English } of every contribution. A key outside the contributor's own module, malformed, or with an
 * empty or oversized text is dropped; a contributor that throws is left out of this answer (the screen still loads).
 */
export async function runtimeSources(): Promise<Map<string, TranslationMessages>> {
  const { results } = await ext.aggregate<TranslationSourceProvider, RuntimeTextSource[]>(
    TRANSLATION_SOURCE_POINT, systemCtx('translation admin: the English of run-time texts'), translationSourceLoaders,
    async (provider) => {
      const list = await provider.sources();
      if (!Array.isArray(list)) throw new Error('sources did not answer a list');
      return list.slice(0, MAX_PER_PROVIDER);
    },
  );
  const out = new Map<string, TranslationMessages>();
  for (const r of results as Array<{ contribution: { moduleId: string }; value: RuntimeTextSource[] }>) {
    const own = r.contribution.moduleId;
    for (const s of r.value) {
      if (!s || s.module !== own || typeof s.en !== 'string' || !s.en.trim() || s.en.length > MAX_TEXT) continue;
      if (!s.key.startsWith(`${own}.`) || !KeySchema.safeParse(s.key).success) continue;
      const messages = out.get(own) ?? {};
      messages[s.key] = s.en;
      out.set(own, messages);
    }
  }
  return out;
}

/** The run-time English of one module; {} when none, or when the contributions cannot be read. */
export async function runtimeEnglishOf(module: string): Promise<TranslationMessages> {
  try {
    return (await runtimeSources()).get(module) ?? {};
  } catch {
    return {};
  }
}
