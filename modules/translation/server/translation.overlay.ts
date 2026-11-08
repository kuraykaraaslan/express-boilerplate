import { setMessageOverlay } from '@kuraykaraaslan-labs/i18n/server/messages';
import TranslationReadService from './translation.read.service';

/**
 * Boot task (`common:boot_task`, phase `runtime`): lays the stored texts over every
 * module's server messages, so `loadServerT(dictionaries, locale)` in an email or a
 * notification reads them through the cache (database > JSON > English).
 *
 * Server-rendered texts are read on the `web` platform: shared rows plus web rows. A
 * locale or module id the read service refuses throws, and `loadServerT` fails open to
 * the dictionaries.
 */
export function registerTranslationOverlay(): void {
  setMessageOverlay(async (locale, moduleId) => (await TranslationReadService.getBundle(locale, moduleId, 'web')).messages);
}
