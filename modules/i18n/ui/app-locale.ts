// The `app_locale` cookie — the fast SSR mirror of the user's durable
// `user_preferences.language`. Kept a dependency-free leaf so every writer
// (topbar switcher, profile preferences form) uses the SAME cookie name and
// attributes; a mismatch here silently strands the setting (the RSC layout
// reads this cookie and nothing else). The name itself lives in the leaf
// `server/i18n.locale.ts`, so server routes that answer in the caller's UI
// language read the same cookie.

import { APP_LOCALE_COOKIE } from '../server/i18n.locale';

export { APP_LOCALE_COOKIE };

/** Mirror the chosen application language into the SSR cookie. Browser only. */
export function setAppLocaleCookie(lang: string): void {
  if (typeof document === 'undefined') return;
  const code = (lang || '').toLowerCase().split('-')[0];
  if (!code) return;
  document.cookie = `${APP_LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
}

/** Read the current cookie value (browser only; '' when unset). */
export function getAppLocaleCookie(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${APP_LOCALE_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}
