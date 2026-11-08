'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Messages, Direction, TFunction } from './types';
import { interpolate } from './interpolate';

type I18nValue = {
  locale: string;
  dir: Direction;
  t: TFunction;
  /**
   * The languages this tenant actually accepts (enabled ∩ shipped dictionaries).
   * Any picker that writes the application language MUST offer only these — the
   * server clamps anything else back to the tenant default, so a wider list
   * silently no-ops.
   */
  languages: string[];
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Provides the resolved application language + a `t()` for the admin UI. Seeded
 * server-side (the RSC layout resolves the locale and passes the active-locale
 * message bundle in as a prop). `t(key, fallback?, vars?)` returns
 * `messages[key] ?? fallback ?? key`, interpolating `{{vars}}`. The `dir` is
 * applied to a `display:contents` wrapper so RTL cascades to the subtree without
 * touching the root <html>.
 */
export function I18nProvider({
  locale,
  dir = 'ltr',
  messages,
  languages,
  children,
}: {
  locale: string;
  dir?: Direction;
  messages: Messages;
  /** Tenant-enabled languages that have a dictionary; defaults to `[locale]`. */
  languages?: string[];
  children: ReactNode;
}) {
  const key = (languages || []).join(',');
  const value = useMemo<I18nValue>(() => {
    const t: TFunction = (key, fallback, vars) => {
      const raw = messages[key] ?? fallback ?? key;
      return vars ? interpolate(raw, vars) : raw;
    };
    return { locale, dir, t, languages: languages?.length ? languages : [locale] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, dir, messages, key]);

  return (
    <I18nContext.Provider value={value}>
      <div dir={dir} className="contents">{children}</div>
    </I18nContext.Provider>
  );
}

// One object for every render: `t` sits in many effect and callback dependency lists, so a fresh fallback per call
// re-ran those effects after every render. On /auth/select-tenant, which has no provider, that refetched the session
// and the tenant list in a loop, ~60 requests a second.
const NO_PROVIDER: I18nValue = {
  locale: 'en',
  dir: 'ltr',
  languages: ['en'],
  t: (key, fallback, vars) => {
    const raw = fallback ?? key;
    return vars ? interpolate(raw, vars) : raw;
  },
};

/** Full i18n context. Falls back to an identity `t` when no provider is mounted. */
export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? NO_PROVIDER;
}

/** The translate function for the current application language. */
export function useT(): TFunction {
  return useI18n().t;
}

export function useLocale(): string {
  return useI18n().locale;
}

export function useDir(): Direction {
  return useI18n().dir;
}

/**
 * The application languages the user may actually switch to. Use this for any
 * application-language picker instead of the full ISO catalogue — see the
 * `languages` note on I18nValue.
 */
export function useAppLanguages(): string[] {
  return useI18n().languages;
}

// ── A provider's language lent to the UI mounted above it ───────────────────────────────────────────────────────────

/**
 * The language of the innermost `I18nProvider` that shares it (`<SharedI18nSource />`), lent to UI the app mounts above every
 * provider: the root's `ConfirmHost` (app/providers.tsx) draws every imperative question, and without this its own words
 * ("Cancel", "Confirm", the close button) read the no-provider fallback inside a Turkish admin shell (re-run 4 #43). One list
 * per page, the newest source last; a source that unmounts takes its language back.
 */
const sharedSources: I18nValue[] = [];
const sharedListeners = new Set<() => void>();
const sharedNow = (): I18nValue | null => sharedSources[sharedSources.length - 1] ?? null;
const sharedSubscribe = (l: () => void) => { sharedListeners.add(l); return () => { sharedListeners.delete(l); }; };
const sharedChanged = () => { for (const l of sharedListeners) l(); };

/** Mounted inside an `I18nProvider`: shares its language with `<SharedI18n>` above every provider while it is mounted. Draws nothing. */
export function SharedI18nSource(): null {
  const value = useContext(I18nContext);
  useEffect(() => {
    if (!value) return;
    sharedSources.push(value);
    sharedChanged();
    return () => {
      const i = sharedSources.lastIndexOf(value);
      if (i >= 0) sharedSources.splice(i, 1);
      sharedChanged();
    };
  }, [value]);
  return null;
}

/**
 * Its children speak the shared language (`SharedI18nSource`) when they have no provider of their own; a provider above it keeps its
 * own, and without a source they read the no-provider fallback as before. The tree is the same either way, so nothing remounts when a
 * source comes or goes.
 */
export function SharedI18n({ children }: { children: ReactNode }) {
  const own = useContext(I18nContext);
  const shared = useSyncExternalStore(sharedSubscribe, sharedNow, () => null);
  return <I18nContext.Provider value={own ?? shared}>{children}</I18nContext.Provider>;
}

