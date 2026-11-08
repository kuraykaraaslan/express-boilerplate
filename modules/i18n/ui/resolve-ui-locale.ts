// Pure application-locale resolution: user preference → tenant default → 'en',
// clamped to the enabled set. The implementation is the dependency-free
// `server/i18n.locale.ts` (ui may import server, never the reverse), so a server
// route resolves the caller's locale exactly as the RSC layout does.
export { resolveAppLocale } from '../server/i18n.locale';
