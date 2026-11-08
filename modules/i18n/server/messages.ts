// Server-side message resolution from a module's own dictionaries — for emails,
// notifications, and API/error strings (the recipient's locale, not the request
// UI's). Framework-free: a module feeds its `dictionaries` object and gets a `t`.
// Mirrors modules/auth/server/dictionaries/index.ts, generalized + prefixed keys.
import { interpolate, type Messages } from './i18n.core';

/** locale code → messages (e.g. `{ en, tr }` from a module's dictionaries barrel). */
export type Dictionaries = Record<string, Messages>;

const base = (locale: string | null | undefined, fallback: string) =>
  ((locale || fallback).toLowerCase().split('-')[0]) || fallback;

/** Merge a locale's messages over the default-locale base (per-key fallback). */
export function getMessages(dicts: Dictionaries, locale: string, defaultLocale = 'en'): Messages {
  const code = base(locale, defaultLocale);
  return { ...(dicts[defaultLocale] || {}), ...(dicts[code] || {}) };
}

/**
 * Build a server `t(key, locale, fallback?, vars?)` bound to a module's dictionaries.
 * Resolution: dicts[locale][key] → dicts[default][key] → fallback → key, with `{{vars}}`.
 * Static: it never reads stored texts. For those, use `loadServerT`.
 */
export function createServerT(dicts: Dictionaries, defaultLocale = 'en') {
  return (key: string, locale: string, fallback?: string, vars?: Record<string, string | number>): string => {
    const code = base(locale, defaultLocale);
    const raw = dicts[code]?.[key] ?? dicts[defaultLocale]?.[key] ?? fallback ?? key;
    return vars ? interpolate(raw, vars) : raw;
  };
}

// ── Stored-text overlay ─────────────────────────────────────────────────────

/**
 * Texts kept outside the code for one locale and one module (`translation` contributes it at
 * boot), laid over that module's dictionaries by `loadServerT`. `i18n` stays dependency-free:
 * it only holds the function.
 */
export type MessageOverlay = (locale: string, moduleId: string) => Promise<Messages>;

// On globalThis: inside the Next server, instrumentation (where the boot task registers the
// overlay) and the route handlers are separate bundle graphs that each evaluate this module.
const OVERLAY_SLOT = Symbol.for('nb.i18n.messageOverlay');
const overlayStore = globalThis as typeof globalThis & { [OVERLAY_SLOT]?: MessageOverlay | null };

/** Install (or with null, remove) the stored-text overlay. Called once per process at boot. */
export function setMessageOverlay(overlay: MessageOverlay | null): void {
  overlayStore[OVERLAY_SLOT] = overlay;
}

/** A server `t` already bound to one locale: `t(key, fallback?, vars?)`. */
export type BoundServerT = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

/** The module ids a dictionary's keys are prefixed with (`auth.login.title` → `auth`). */
function moduleIdsOf(dicts: Dictionaries): string[] {
  const ids = new Set<string>();
  for (const messages of Object.values(dicts)) {
    for (const key of Object.keys(messages)) {
      const dot = key.indexOf('.');
      if (dot > 0) ids.add(key.slice(0, dot));
    }
  }
  return [...ids];
}

/**
 * The stored texts for `locale` over every module of `dicts`: the base language first, the full
 * tag (`pt-br`) over it. Fails open: no overlay installed, or one that throws, is no stored text.
 */
async function loadOverlay(dicts: Dictionaries, locale: string, code: string): Promise<Messages> {
  const overlay = overlayStore[OVERLAY_SLOT];
  if (!overlay) return {};
  const modules = moduleIdsOf(dicts);
  const locales = locale === code ? [code] : [code, locale];
  try {
    const parts = await Promise.all(locales.flatMap((l) => modules.map((m) => overlay(l, m))));
    return Object.assign({}, ...parts) as Messages;
  } catch {
    return {};
  }
}

/**
 * Like `createServerT`, with the stored texts of the overlay laid over the dictionaries, and
 * bound to one locale. Resolution: stored[key] → dicts[locale][key] → dicts[default][key] →
 * fallback → key. Async because the stored texts are read (through a cache) when it is called;
 * call it once per message or batch, not once per process.
 *
 *   const t = await loadServerT(dictionaries, recipientLocale);
 *   t('auth.mail.subject', 'Welcome', { name });
 */
export async function loadServerT(dicts: Dictionaries, locale: string, defaultLocale = 'en'): Promise<BoundServerT> {
  const code = base(locale, defaultLocale);
  const full = (locale || defaultLocale).trim().toLowerCase() || code;
  const stored = await loadOverlay(dicts, full, code);
  return (key, fallback, vars) => {
    const raw = stored[key] ?? dicts[code]?.[key] ?? dicts[defaultLocale]?.[key] ?? fallback ?? key;
    return vars ? interpolate(raw, vars) : raw;
  };
}
