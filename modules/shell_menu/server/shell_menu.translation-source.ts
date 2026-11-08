import type { RuntimeTextSource, TranslationSourceProvider } from '@kuraykaraaslan-labs/translation/server/translation.sources.types';
import ShellMenuReadService from './shell_menu.read.service';
import { SHELL_MENU_MODULE, specLabelSources } from './shell_menu.keys';

// The menu's own texts in Platform → Translations (docs/phases/54-menu-editor, D54-8): every label key of the published
// menu with its English, contributed to `translation:source`, so the screen lists, counts and exports them like any key.

const provider: TranslationSourceProvider = {
  async sources(): Promise<RuntimeTextSource[]> {
    const published = await ShellMenuReadService.published();
    if (!published) return [];
    return [...specLabelSources(published.spec)].map(([key, en]) => ({ module: SHELL_MENU_MODULE, key, en }));
  },
};

export default provider;
