// Vendored from kui-react f7db139: modules/app/WidgetKit/settings/types.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// Settings templates for dashboard widgets (next-boilerplate phase 21).
//
// A template is the versioned description of one part of a widget's settings: the common card
// (`core:card`), the value format (`core:format`), the board (`core:board`) or one widget type
// (`builtin:<type>`). Pure TypeScript, no React: next-boilerplate's server validates and migrates
// with the same code its browser renders with.

import type { FieldSchema, FontValue } from '../_app/SchemaForm/types';

export type TemplateId =
  | 'core:card' | 'core:format' | 'core:board'
  | `builtin:${string}` | `ext:${string}` | `manifest:${string}` | `x:${string}` | `tenant:${string}`;

/**
 * Where a template's values live inside a settings object. '' = top level (the widget type's own
 * keys); `$card`, `$format`, `$x:<module>` are reserved namespaces.
 */
export type TemplateNamespace = '' | '$card' | '$format' | `$x:${string}`;

export type EditorTab = 'Display' | 'Data' | 'Card' | 'Actions' | 'Look' | 'Toolbar' | 'Behaviour';

export interface TemplateField extends FieldSchema {
  /** The template version that introduced the field. */
  since: number;
  /** Hidden from the editor, still read; a later version drops it. */
  deprecated?: { since: number; replacedBy?: string; removeIn: number };
}

export interface TemplateGroup {
  id: string;
  label: string;
  tab: EditorTab;
  since: number;
  /** Only shown when this holds for the widget (a capability or a bound slot). */
  showWhen?: { caps?: keyof WidgetCaps; slotBound?: string };
}

/** What a widget can do; decides which common groups apply. */
export interface WidgetCaps {
  /** It reads bound data (has data slots). */
  hasData: boolean;
  /** Its data can be downloaded as CSV. */
  exportable: boolean;
  /** It prints numbers, so `core:format` applies. */
  formatsNumbers: boolean;
  /**
   * A bound query follows a time window (the host knows: a template cannot), so the card may offer its own window
   * selector (`core:card` showWindow). Absent = no.
   */
  windowed?: boolean;
}

export type Sparse = Record<string, unknown>;

/**
 * Declarative migration operations: the only kind a tenant-authored template may use (rename,
 * mapValue, materializeDefault, clamp, drop, each, filterList). Every op is pure, sparse-safe and
 * idempotent; an op the engine does not know leaves the values unchanged.
 *
 * `filterList` cleans a list value (e.g. a multi-select after an option was removed): it drops the
 * items whose `String(item)` is in `remove`, or is not in `keep` when `keep` is given. A non-empty
 * list that ends up empty removes the key, so the card falls back to its default. A non-array value
 * or a missing key is left untouched.
 */
export type MigrationOp =
  | { op: 'rename'; from: string; to: string }
  | { op: 'mapValue'; key: string; map: Record<string, unknown>; else?: unknown }
  | { op: 'materializeDefault'; key: string; value: unknown }
  | { op: 'clamp'; key: string; min?: number; max?: number }
  | { op: 'drop'; key: string }
  | { op: 'each'; key: string; ops: MigrationOp[] }
  | { op: 'filterList'; key: string; remove?: string[]; keep?: string[] };

export interface MigrationStep {
  from: number;
  /** Always `from + 1`. */
  to: number;
  /** One line, shown in the editor's upgrade notice and the changelog. */
  note: string;
  ops?: MigrationOp[];
  /** Code escape hatch for code-owned templates only. Pure; must not assume any key exists. */
  up?: (settings: Sparse) => Sparse;
  /** A changed default: 'preserve' keeps old boards' look, 'propagate' changes them on purpose. */
  defaultChanges?: Array<{ key: string; from: unknown; to: unknown; policy: 'preserve' | 'propagate' }>;
}

export interface SettingsTemplate {
  id: TemplateId;
  /** Current version; monotonic integer starting at 1. */
  version: number;
  namespace: TemplateNamespace;
  label: string;
  groups: TemplateGroup[];
  fields: Record<string, TemplateField>;
  /** Contiguous and append-only: migrations[i] goes from version i+1 to i+2. */
  migrations: MigrationStep[];
  /** Cross-field checks, e.g. min below max. */
  rules?: Array<(values: Sparse) => Issue[]>;
  /** The widget prints numbers (core:format applies). Type templates only. */
  format?: boolean;
  /** The widget's data can be exported as CSV. Type templates only. */
  exportable?: boolean;
  /** Card defaults this widget type needs (e.g. a map has no padding). Type templates only. */
  cardDefaults?: Sparse;
  /** Value-format defaults for this widget type. Type templates only. */
  formatDefaults?: Sparse;
  /** The setting a source's `direction` (higher / lower is better) defaults, e.g. `increaseIs`. Type templates only. */
  directionField?: string;
  /**
   * The settings a source's declared range (`ColumnMeta.min` / `max`) defaults, e.g. a gauge's scale. A person's own
   * value, a preset's and a bound slot still win. Type templates only.
   */
  scaleFields?: { min: string; max: string };
  /** Terminal: the type was retired; its steps stay so old data still migrates. */
  retired?: boolean;
}

/** `settings.$v`: which template version wrote each part of a settings object. */
export type SettingsStamp = Partial<Record<TemplateId, number>>;

/**
 * What an issue is about, so a host can show it in its own language (`messages.issues`). The engine's
 * field checks and the kit's cross-field rules set one; a host's own rule may leave it out.
 */
export type IssueCode =
  | 'boolean' | 'number' | 'min' | 'max' | 'option' | 'notOption' | 'optionList' | 'unknownOption'
  | 'color' | 'icon' | 'dataKeys' | 'maxKeys' | 'dataKey' | 'font' | 'list' | 'maxItems' | 'text'
  | 'maxLength' | 'url' | 'required'
  | 'minBelowMax' | 'linkTarget' | 'imageSrc' | 'embedUrl' | 'rowLinkTarget' | 'modelUrl' | 'positiveStep'
  | 'mediaSrc' | 'subtitleSrc';

/** The values an issue's text names: the field's own label (as the template has it) and a bound or an option. */
export interface IssueParams {
  label?: string;
  min?: number;
  max?: number;
  option?: string;
}

export interface Issue {
  path: string;
  /** English, for logs and API callers; a host shows `code` + `params` in its language instead. */
  message: string;
  code?: IssueCode;
  params?: IssueParams;
}

/** Effective `core:card` values (defaults already layered in). */
export interface CardSettings {
  showTitle?: boolean;
  titleFont?: FontValue;
  titleColor?: string;
  subtitle?: string;
  subtitleColor?: string;
  titleIcon?: string;
  titleIconColor?: string;
  titleIconSize?: number;
  titleTooltip?: string;
  variant?: 'raised' | 'flat' | 'outline' | 'plain';
  padding?: number;
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  textColor?: string;
  background?: 'default' | 'color' | 'image' | 'none';
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: 'cover' | 'contain' | 'fill' | 'auto';
  overlayColor?: string;
  overlayBlur?: number;
  buttons?: Array<'fullscreen' | 'export' | 'refresh'>;
  /** The board's time window selector in the card's header, for this card alone (`timeWindow` on the card). */
  showWindow?: boolean;
  noDataText?: string;
  /** With no data: the widget's empty shape under the no-data text (`shape`, default) or the text alone. */
  emptyDisplay?: 'shape' | 'message';
  showUpdated?: 'off' | 'relative' | 'time' | 'date' | 'datetime';
  staleAfterSeconds?: number;
  staleDisplay?: 'badge' | 'dim' | 'hide';
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
  mobileOrder?: number;
  mobileHeight?: number;
}
