import en from '../dictionaries/en.json'
import tr from '../dictionaries/tr.json'
import { normalizeLocale } from './status.page.rules'

/**
 * The words around the data of the static snapshot and the widget (observability phase 15 item iii): the banner, the status names, the
 * "Last updated" line, the headings, the staleness notice. They used to be string literals in `status.static.html.ts`; they now come from the
 * module's own dictionary (`dictionaries/*.json`, the same files the UI reads), looked up per snapshot language.
 *
 * Constraints, each one deliberate:
 *  - PURE. A snapshot is a static file built without the application's i18n runtime and must not need the database, so the lookup is a function of
 *    the language code over two JSON files imported at build time. No I/O, no clock, no globals.
 *  - ENGLISH IS AUTHORITATIVE (decision D-OBS-13). Other locales hold English placeholders until the translation process runs; a language the
 *    dictionary does not have at all is served the English chrome (the page's `lang` attribute still says what the data is written in), and a key
 *    missing from a locale falls back to English, so a snapshot can never print a raw key.
 *  - The data (component names, incident wording) is translated by the tenant through the translation screen, not here: this file is only chrome.
 *  - Output is escaped by the renderer, not here: a value is plain text.
 */

type Dict = Record<string, string>
const LOCALES: Record<string, Dict> = { en, tr }

/** The locales the dictionary holds (the parity test walks this list). */
export const CHROME_LOCALES: readonly string[] = Object.keys(LOCALES)

/** The dictionary of one locale, exactly as stored (for the parity test and for tooling). */
export function chromeDictionary(locale: string): Readonly<Dict> | undefined {
  return LOCALES[locale]
}

export type ChromeVars = Record<string, string | number>

export interface SnapshotChrome {
  /** The dictionary language the strings come from (`en` for any language the dictionary lacks). */
  readonly locale: string
  t(key: string, vars?: ChromeVars): string
  /** The name of a component or page status (`OPERATIONAL` -> "Operational"). */
  status(status: string): string
  /** The banner line for an overall status. */
  banner(status: string): string
}

const STATUS_KEYS: Record<string, string> = {
  OPERATIONAL: 'operational', DEGRADED: 'degraded', PARTIAL_OUTAGE: 'partialOutage', MAJOR_OUTAGE: 'majorOutage', MAINTENANCE: 'maintenance',
}
const BANNER_KEYS: Record<string, string> = {
  OPERATIONAL: 'allOperational', DEGRADED: 'someDegraded', PARTIAL_OUTAGE: 'partialBanner', MAJOR_OUTAGE: 'majorBanner', MAINTENANCE: 'maintenanceBanner',
}

/** `de-AT` -> the first of `de-at`, `de` the dictionary holds, else `en`. */
export function chromeLocaleFor(language: string | null | undefined): string {
  const l = normalizeLocale(language ?? '')
  if (l && LOCALES[l]) return l
  const base = l.split('-')[0]
  return base && LOCALES[base] ? base : 'en'
}

function interpolate(text: string, vars?: ChromeVars): string {
  if (!vars) return text
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

export function chromeFor(language: string | null | undefined): SnapshotChrome {
  const locale = chromeLocaleFor(language)
  const dict = LOCALES[locale]
  const t = (key: string, vars?: ChromeVars) => interpolate(dict[key] ?? en[key as keyof typeof en] ?? key, vars)
  return {
    locale,
    t,
    status: (s) => (STATUS_KEYS[s] ? t(`observability.status.${STATUS_KEYS[s]}`) : 'Unknown'),
    banner: (s) => (BANNER_KEYS[s] ? t(`observability.status.${BANNER_KEYS[s]}`) : s),
  }
}

/** Every key the snapshot and widget renderers ask for. The parity test checks each exists in every locale of the dictionary. */
export const SNAPSHOT_CHROME_KEYS: readonly string[] = [
  ...Object.values(STATUS_KEYS).map((k) => `observability.status.${k}`),
  ...Object.values(BANNER_KEYS).map((k) => `observability.status.${k}`),
  'observability.status.activeIncidents', 'observability.status.pastIncidents', 'observability.status.noComponents',
  'observability.status.fallback', 'observability.status.incidentMarker', 'observability.status.noData',
  'observability.status.maintenanceTitle', 'observability.status.maintenanceActive', 'observability.status.maintenanceUpcoming',
  'observability.status.regions', 'observability.status.regionUptime', 'observability.status.responseTime', 'observability.status.responseTimeNote', 'observability.status.responseTimeSummary',
  'observability.status.snapshot.lastUpdated', 'observability.status.snapshot.noscript', 'observability.status.snapshot.staleNotice',
  'observability.status.snapshot.title', 'observability.status.snapshot.updatedShort',
]
