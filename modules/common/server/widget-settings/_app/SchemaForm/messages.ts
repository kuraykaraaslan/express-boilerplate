// Vendored from kui-react f7db139: modules/app/SchemaForm/messages.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The texts SchemaForm draws on its own (reset buttons, search, the colour, font, JSON and repeater
// controls, the "required" message), so a host can show them in its language. Pure: no React, no
// .tsx import (WidgetKit's `messages.ts` reads these, and next-boilerplate's server copy holds no
// component). A function takes the values a text interpolates.

export interface SchemaFormMessages {
  /** A form without fields (the `emptyMessage` prop wins). */
  empty: string;
  /** The dot next to a field that differs from its default. */
  modified: string;
  reset: string;
  resetLabel: (label: string) => string;
  searchLabel: string;
  searchPlaceholder: string;
  /** A list field typed as text. */
  commaSeparated: string;
  /** A checkbox without its own caption. */
  enabled: string;
  /** The two choices of an on / off value (`display: 'segmented'` on a boolean, a switch a command sets). */
  on: string;
  off: string;
  themeColours: (label: string) => string;
  pickColour: (label: string) => string;
  /** The free colour box when it is empty. */
  colourDefault: string;
  /** Opens the free colour box when a theme colour is picked (the theme colour is shown by its name, never as a `var(--…)` code). */
  colourCustom: string;
  clear: string;
  clearLabel: (label: string) => string;
  /** The theme swatches (`THEME_COLOR_TOKENS`), by token. */
  colorPrimary: string;
  colorSecondary: string;
  colorSuccess: string;
  colorInfo: string;
  colorWarning: string;
  colorError: string;
  colorText: string;
  colorMutedText: string;
  colorStrongBorder: string;
  colorRaisedSurface: string;
  colorSunkenSurface: string;
  fontSize: (label: string) => string;
  fontSizePlaceholder: string;
  fontUnit: (label: string) => string;
  fontWeight: (label: string) => string;
  fontWeightPlaceholder: string;
  fontFamily: (label: string) => string;
  fontFamilyPlaceholder: string;
  fontSans: string;
  fontSerif: string;
  fontMono: string;
  fontItalic: string;
  invalidJson: string;
  moveUp: string;
  up: string;
  moveDown: string;
  down: string;
  removeItem: string;
  remove: string;
  /** A repeater item without a text to name it; `n` counts from 1. */
  item: (n: number) => string;
  addItem: string;
  /** `validateSchemaValues`: a required field without a value. */
  required: (label: string) => string;
}

export const DEFAULT_SCHEMA_FORM_MESSAGES: SchemaFormMessages = {
  empty: 'No settings.',
  modified: 'Modified from default',
  reset: 'Reset',
  resetLabel: (label) => `Reset ${label} to default`,
  searchLabel: 'Search settings',
  searchPlaceholder: 'Search settings...',
  commaSeparated: 'Comma separated',
  enabled: 'Enabled',
  on: 'On',
  off: 'Off',
  themeColours: (label) => `${label}: theme colours`,
  pickColour: (label) => `${label}: pick a colour`,
  colourDefault: 'Default',
  colourCustom: 'Custom…',
  clear: 'Clear',
  clearLabel: (label) => `Clear ${label}`,
  colorPrimary: 'Primary',
  colorSecondary: 'Secondary',
  colorSuccess: 'Success',
  colorInfo: 'Info',
  colorWarning: 'Warning',
  colorError: 'Error',
  colorText: 'Text',
  colorMutedText: 'Muted text',
  colorStrongBorder: 'Strong border',
  colorRaisedSurface: 'Raised surface',
  colorSunkenSurface: 'Sunken surface',
  fontSize: (label) => `${label}: size`,
  fontSizePlaceholder: 'Size',
  fontUnit: (label) => `${label}: unit`,
  fontWeight: (label) => `${label}: weight`,
  fontWeightPlaceholder: 'Weight',
  fontFamily: (label) => `${label}: family`,
  fontFamilyPlaceholder: 'Font',
  fontSans: 'Sans',
  fontSerif: 'Serif',
  fontMono: 'Mono',
  fontItalic: 'Italic',
  invalidJson: 'Invalid JSON',
  moveUp: 'Move up',
  up: 'Up',
  moveDown: 'Move down',
  down: 'Down',
  removeItem: 'Remove item',
  remove: 'Remove',
  item: (n) => `Item ${n}`,
  addItem: 'Add item',
  required: (label) => `${label} is required`,
};

/** The message key of each theme swatch, by its token value (the stored value never changes). */
export const THEME_COLOR_MESSAGE: Readonly<Record<string, keyof SchemaFormMessages>> = {
  'var(--primary)': 'colorPrimary',
  'var(--secondary)': 'colorSecondary',
  'var(--success)': 'colorSuccess',
  'var(--info)': 'colorInfo',
  'var(--warning)': 'colorWarning',
  'var(--error)': 'colorError',
  'var(--text-primary)': 'colorText',
  'var(--text-secondary)': 'colorMutedText',
  'var(--border-strong)': 'colorStrongBorder',
  'var(--surface-raised)': 'colorRaisedSurface',
  'var(--surface-sunken)': 'colorSunkenSurface',
};

/** The defaults with `input` over them; an `undefined` value keeps the default. */
export function mergeSchemaFormMessages(input?: Partial<SchemaFormMessages>): SchemaFormMessages {
  if (!input) return DEFAULT_SCHEMA_FORM_MESSAGES;
  const out = { ...DEFAULT_SCHEMA_FORM_MESSAGES } as Record<string, unknown>;
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out as unknown as SchemaFormMessages;
}
