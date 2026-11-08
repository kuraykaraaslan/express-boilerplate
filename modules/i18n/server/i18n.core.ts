// Pure i18n primitives shared by the client runtime (../ui) and the server
// message helper (./messages). Lives in server/ because `ui` may import
// `server`, but `server` may NOT import `ui` (lint: no-restricted-imports).
export type Messages = Record<string, string>;
export type Locale = string;
export type Direction = 'ltr' | 'rtl';
export type TFunction = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

/** Replace {{var}} placeholders (auth-dictionary grammar); unknown vars → ''. */
export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (values[key] != null ? String(values[key]) : ''));
}
