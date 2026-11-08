// Vendored from kui-react f7db139: modules/app/WidgetKit/views/overlay-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The part of every overlay that is the same whatever it is drawn on (pure, no React): when a name is shown, what counts as an alert,
// and how a row is kept from carrying an identity it was asked to hide. The map card and the 3D model card read their settings through it, so
// a label means the same on both, and so does the people layer of kui-viewer (docs/reference/overlay-standard.md there).
//
// A card's hover and click are its tooltip (`tooltipTrigger`), which already opens on either; the label mode is only about the permanent name
// beside a marker or over a thing: `always`, `alerts` (only whoever is in trouble) or `none`. kui-viewer's people layer has no tooltip, so it also
// has `hover` and `click`.

export type Row = Record<string, unknown>;

export const LABEL_MODES = ['always', 'alerts', 'none'] as const;
export type LabelMode = (typeof LABEL_MODES)[number];

export const isLabelMode = (v: unknown): v is LabelMode => typeof v === 'string' && (LABEL_MODES as readonly string[]).includes(v);

/**
 * The label mode a card's settings ask for: its `labelMode` (or whichever `key` names: a 3D model has one for sensors and `thingLabelMode` for
 * things), or, for a card saved before it existed, what its older on / off switch said (`on` when the switch is on, `none` when it is off),
 * or `fallback`. A stored board is migrated when it is opened, so this only matters to a caller that reads settings that were not.
 */
export function labelModeOf(settings: Row, key = 'labelMode', legacyKey?: string, on: LabelMode = 'always', fallback: LabelMode = 'always'): LabelMode {
  const mode = settings[key];
  if (isLabelMode(mode)) return mode;
  if (legacyKey !== undefined && typeof settings[legacyKey] === 'boolean') return settings[legacyKey] ? on : 'none';
  return fallback;
}

/** The words a status column says when somebody is in trouble: a warning or worse, and the alert words of a person (an SOS, a fall…). */
export const ALERT_WORDS = ['warning', 'warn', 'critical', 'alarm', 'alert', 'error', 'fault', 'danger', 'sos', 'fall', 'zone', 'ppe', 'still'] as const;

/** Whether a cell says an alert: a word of `ALERT_WORDS` (any case), `true`, or the numbers 1 and 2 (a status as a code). */
export function isAlertValue(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1 || raw === 2;
  if (typeof raw !== 'string') return false;
  const w = raw.trim().toLowerCase();
  return w === '1' || w === '2' || (ALERT_WORDS as readonly string[]).includes(w);
}

/** Whether a permanent label is drawn for something that is, or is not, an alert. */
export const labelShown = (mode: LabelMode, alert: boolean): boolean => mode === 'always' || (mode === 'alerts' && alert);

export interface IdentitySettings {
  /** Privacy mode (KVKK / GDPR): the identity columns are left out wherever the card puts a row, and the label says the role. */
  labelAnonymous?: boolean;
  /** The column that says the role: the label in privacy mode. */
  roleColumn?: string;
  /** The columns that say who it is (a name, a badge number, a company), besides the label column. */
  identityColumns?: string[];
  labelColumn?: string;
}

/** The columns that identify, when the card is anonymous: its label column and the identity columns. Empty when it is not. */
export function hiddenColumns(s: IdentitySettings): string[] {
  if (s.labelAnonymous !== true) return [];
  const extra = Array.isArray(s.identityColumns) ? s.identityColumns.filter((k): k is string => typeof k === 'string' && k !== '') : [];
  return [...new Set([...(s.labelColumn ? [s.labelColumn] : []), ...extra])];
}

/** A row without the columns that identify (a copy), or the row itself when there are none: the row a click reports and a tooltip lists. */
export function redactRow(row: Row, columns: readonly string[]): Row {
  if (columns.length === 0) return row;
  const out: Row = { ...row };
  for (const k of columns) delete out[k];
  return out;
}

/** The text of a permanent label: the label column, or, in privacy mode, the role (and nothing else: never a name). */
export function labelText(row: Row, s: IdentitySettings): string | undefined {
  const col = s.labelAnonymous === true ? s.roleColumn : s.labelColumn;
  const v = col ? row[col] : undefined;
  return v !== undefined && v !== null && v !== '' ? String(v) : undefined;
}
