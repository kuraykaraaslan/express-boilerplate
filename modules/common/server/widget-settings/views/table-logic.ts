// Vendored from kui-react f7db139: modules/app/WidgetKit/views/table-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The pure logic of the data table (no React, no DOM): column resolution from the source's meta and the
// placement's settings, cell text, value maps, sorting, row colour rules, history filtering and CSV cells.
// `DataTableView.tsx` draws it; kui-ejs and KUInative vendor this file so all three share one implementation.

import type { FontValue } from '../_app/SchemaForm/types';
import { metaFormat, valueMapList } from '../settings/source-meta';
import { cssColor, fontStyle, formatValue, rangeFor, tint, type RangeEdges, type ValueFormat } from '../settings/style';
import type { StyleRecord } from '../card-logic';
import type { Sparse } from '../settings/types';
import type { SlotData } from '../kind';
import type { CommonMessages, TableMessages } from '../messages';
import { isInternalPath } from '../templates/map';

// ── Shared data helpers (also used by the feed and map views) ───────────────────

export type Row = Record<string, unknown>;
export type DeclaredColumn = NonNullable<SlotData['columns']>[number];

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const TONE_NAMES = ['success', 'warning', 'error', 'info', 'neutral', 'primary'] as const;
export type ToneName = (typeof TONE_NAMES)[number];
const TONE_VAR: Record<ToneName, string> = {
  success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)',
  info: 'var(--info)', neutral: 'var(--text-secondary)', primary: 'var(--primary)',
};
export const toneOf = (v: unknown): ToneName | undefined => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (TONE_NAMES as readonly string[]).includes(s) ? (s as ToneName) : undefined;
};

/** A colour from DATA: a tone name (`success`) or any CSS colour that `cssColor` accepts; else undefined. */
export function dataColor(v: unknown): string | undefined {
  const tone = toneOf(v);
  return tone ? TONE_VAR[tone] : cssColor(v);
}

/** Common status words and the tone they mean, so a plain "Online" / "Offline" column reads right without setup. */
const STATUS_WORDS: Record<string, ToneName> = {
  online: 'success', active: 'success', ok: 'success', running: 'success', healthy: 'success', up: 'success',
  done: 'success', completed: 'success', resolved: 'success', connected: 'success', enabled: 'success', normal: 'success',
  warning: 'warning', warn: 'warning', degraded: 'warning', pending: 'warning', idle: 'warning', maintenance: 'warning', minor: 'warning', major: 'warning',
  offline: 'error', error: 'error', failed: 'error', failure: 'error', critical: 'error', down: 'error', alarm: 'error',
  disconnected: 'error', stopped: 'error', fault: 'error',
  info: 'info', new: 'info', open: 'info', indeterminate: 'neutral', unknown: 'neutral', disabled: 'neutral', inactive: 'neutral',
};

/** A tone name, a CSS colour, or a common status word ("Online", "Offline") → a colour; else undefined. */
export function statusColor(v: unknown): string | undefined {
  const direct = dataColor(v);
  if (direct) return direct;
  const word = typeof v === 'string' ? STATUS_WORDS[v.trim().toLowerCase()] : undefined;
  return word ? TONE_VAR[word] : undefined;
}

/** One value → colour mapping row (`valueMap` / `valueColors` settings). */
export interface ValueColor { value?: string; label?: string; color?: string; icon?: string; image?: string }

/** The mapping entry whose value equals the raw value (trimmed, case-insensitive). */
export function matchValue(raw: unknown, map: unknown): ValueColor | undefined {
  if (!Array.isArray(map) || raw === null || raw === undefined) return undefined;
  const key = (typeof raw === 'object' ? JSON.stringify(raw) : String(raw)).trim().toLowerCase();
  return (map as ValueColor[]).find((e) => e && typeof e.value === 'string' && e.value.trim().toLowerCase() === key);
}

/** The declared columns of a table slot; without a declaration, the first row's keys as text. */
export function declaredColumns(slot: SlotData | undefined): DeclaredColumn[] {
  if (slot?.columns?.length) return slot.columns;
  const first = slot?.rows?.[0];
  return first ? Object.keys(first).map((key) => ({ key, label: key, type: typeof first[key] === 'number' ? 'number' : 'text' })) : [];
}

// ── Dates ─────────────────────────────────────────────────────────────────────

export type DateDisplay = 'relative' | 'date' | 'time' | 'datetime' | 'custom';

const hasTimeOfDay = (raw: string) => /[T\s]\d{1,2}:\d{2}/.test(raw);

/** Epoch ms of a date value (ISO text or a number), or null. */
export function toEpoch(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const at = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(at) ? at : null;
}

/**
 * How far ahead of the viewer's clock a stored instant may be and still read as "now": a server that stamped a reading a few seconds after
 * the browser's clock (two machines, two clocks) must not make an "Updated" cell say "in 7 seconds".
 */
export const CLOCK_SKEW_SEC = 120;

/** "5 minutes ago" ("5m ago" narrow) in the viewer's locale; an instant up to `CLOCK_SKEW_SEC` ahead reads as now, never as the future. */
export function relativeTime(at: number, now = Date.now(), locale?: string, style: 'long' | 'short' | 'narrow' = 'long'): string {
  const raw = Math.round((at - now) / 1000);
  const diffSec = raw > 0 && raw <= CLOCK_SKEW_SEC ? 0 : raw;
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diffSec / 86_400), 'day');
  if (abs < 365 * 86_400) return rtf.format(Math.round(diffSec / (30 * 86_400)), 'month');
  return rtf.format(Math.round(diffSec / (365 * 86_400)), 'year');
}

const PATTERN_RE = /'[^']*'|yyyy|yy|MMMM|MMM|MM|M|EEEE|EEE|dd|d|HH|H|hh|h|mm|ss|a/g;

/** A date by a pattern: yyyy yy MMMM MMM MM M EEEE EEE dd d HH H hh h mm ss a; 'quoted' text is literal. */
export function formatDatePattern(d: Date, pattern: string, locale?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h12 = d.getHours() % 12 || 12;
  const parts: Record<string, () => string> = {
    yyyy: () => String(d.getFullYear()),
    yy: () => pad(d.getFullYear() % 100),
    MMMM: () => d.toLocaleString(locale, { month: 'long' }),
    MMM: () => d.toLocaleString(locale, { month: 'short' }),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    EEEE: () => d.toLocaleString(locale, { weekday: 'long' }),
    EEE: () => d.toLocaleString(locale, { weekday: 'short' }),
    dd: () => pad(d.getDate()),
    d: () => String(d.getDate()),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    hh: () => pad(h12),
    h: () => String(h12),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    a: () => (d.getHours() < 12 ? 'AM' : 'PM'),
  };
  return pattern.slice(0, 60).replace(PATTERN_RE, (tok) => (tok.startsWith("'") ? tok.slice(1, -1) : parts[tok]()));
}

export interface DateOptions {
  display?: DateDisplay;
  pattern?: string;
  now?: number;
  /** Relative wording: 'long' = "5 minutes ago", 'narrow' = "5m ago". */
  relativeStyle?: 'long' | 'short' | 'narrow';
  /** The value names a day only (no time of day): time-of-day displays fall back to the date. */
  dateOnly?: boolean;
}

/** An instant as the display setting asks: relative, a short date/time, or a custom pattern. */
export function formatDateValue(at: number, opts: DateOptions = {}, locale?: string): string {
  const d = new Date(at);
  const now = opts.now ?? Date.now();
  const thisYear = d.getFullYear() === new Date(now).getFullYear();
  const date = () => d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) });
  const display = opts.dateOnly && (opts.display === 'time' || opts.display === 'datetime') ? 'date' : opts.display ?? 'relative';
  switch (display) {
    case 'time': return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    case 'date': return date();
    case 'datetime': return `${date()} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
    case 'custom': return opts.pattern?.trim() ? formatDatePattern(d, opts.pattern, locale) : formatDateValue(at, { ...opts, display: 'datetime' }, locale);
    default: return relativeTime(at, now, locale, opts.relativeStyle ?? 'long');
  }
}

/** The full local date and time, for a hover title. */
export const fullDate = (at: number, locale?: string) =>
  new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One cell as display text, by its declared type and the value format (dates by `date`, else as a full
 * local date). `yesNo` words a boolean (default Yes / No).
 */
export function cellText(
  value: unknown, type: DeclaredColumn['type'] | undefined, format: ValueFormat, override: { unit?: string; decimals?: number }, locale?: string,
  date?: DateOptions, yesNo?: CommonMessages,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'number' || override.unit !== undefined || override.decimals !== undefined) {
    if (num(value) !== null) return formatValue(value, type === 'number' ? format : {}, override, locale);
    if (type === 'number') return String(value);
  }
  if (type === 'date') {
    const at = toEpoch(value);
    if (at === null) return String(value);
    const dateOnly = typeof value === 'string' && !hasTimeOfDay(value);
    if (date) return formatDateValue(at, { ...date, dateOnly }, locale);
    const d = new Date(at);
    return dateOnly ? d.toLocaleDateString(locale) : d.toLocaleString(locale);
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 200 ? `${json.slice(0, 197)}…` : json;
  }
  if (typeof value === 'boolean') return value ? yesNo?.yes ?? 'Yes' : yesNo?.no ?? 'No';
  return String(value);
}

/**
 * Expand `/admin/devices/{id}` with a row's values. Only an INTERNAL path may come out: the
 * template is checked BEFORE expansion, and each value is URL-encoded, so a row value cannot add
 * a scheme, a host or a path escape. Null when the template is unsafe or a token has no value.
 */
export function expandLinkTemplate(template: unknown, row: Row | undefined): string | null {
  if (typeof template !== 'string' || !template || !row || !isInternalPath(template)) return null;
  let missing = false;
  const out = template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (_, key: string) => {
    const v = row[key];
    if (v === null || v === undefined || v === '') { missing = true; return ''; }
    return encodeURIComponent(String(v));
  });
  return missing || !isInternalPath(out) ? null : out;
}

/** A CSV cell's raw text. */
export const rawText = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

// ── Table settings and columns ────────────────────────────────────────────────

export type Visible = 'always' | 'desktop' | 'mobile' | 'hidden';
export type Cell = 'auto' | 'text' | 'number' | 'date' | 'badge' | 'bar' | 'progress' | 'link' | 'icon';
export type Wrap = 'nowrap' | 'truncate' | 'wrap';

export interface ColumnSetting {
  key?: string; label?: string; visible?: Visible; cell?: Cell; linkTemplate?: string; sortable?: boolean;
  align?: 'auto' | 'start' | 'center' | 'end'; width?: 'auto' | 'narrow' | 'wide' | 'px'; widthPx?: number;
  unit?: string; decimals?: number; color?: string; headerColor?: string; barMax?: number; ranges?: unknown[];
  dateFormat?: 'inherit' | DateDisplay; datePattern?: string; valueMap?: ValueColor[]; badgeStyle?: 'soft' | 'dot' | 'solid';
  icon?: string; font?: FontValue; wrap?: Wrap;
}

/** A row colour rule: the first matching rule colours the row. */
export interface RowRule {
  column?: string;
  op?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'empty';
  value?: string;
  /** `column`: compare against the row's own `valueColumn` instead of `value` (a threshold held in a sibling column). */
  valueFrom?: 'value' | 'column';
  valueColumn?: string;
  /** The rule applies only to rows whose gate column is true (a flag that says the threshold is armed). */
  gateColumn?: string;
  color?: string;
  target?: 'background' | 'text' | 'bar';
}

export type TableSettings = {
  columns?: ColumnSetting[];
  maxRows?: number;
  paging?: 'none' | 'pages' | 'scroll';
  sortable?: boolean;
  defaultSort?: string;
  defaultSortDir?: 'asc' | 'desc';
  search?: boolean;
  columnPicker?: boolean;
  showRowNumbers?: boolean;
  onlyChanges?: boolean;
  historyLayout?: boolean;
  emptyText?: string;
  dateFormat?: DateDisplay;
  datePattern?: string;
  density?: 'compact' | 'normal' | 'comfortable';
  stickyHeader?: boolean;
  striped?: boolean;
  stripeColor?: string;
  rowHover?: boolean;
  gridLines?: 'rows' | 'all' | 'none';
  borderColor?: string;
  rowColorColumn?: string;
  rowRules?: RowRule[];
  headerFont?: FontValue;
  headerColor?: string;
  headerBackground?: string;
  cellFont?: FontValue;
  cellColor?: string;
  ranges?: unknown;
  rangeEdges?: RangeEdges;
};

/** One effective column: its declaration merged with its settings. */
export interface TableColumn {
  key: string;
  label: string;
  type: DeclaredColumn['type'];
  visible: Visible;
  cell: Exclude<Cell, 'auto'>;
  linkTemplate?: string;
  sortable: boolean;
  align: 'start' | 'center' | 'end';
  width: 'auto' | 'narrow' | 'wide' | 'px';
  widthPx?: number;
  override: { unit?: string; decimals?: number };
  color?: string;
  headerColor?: string;
  barMax?: number;
  ranges?: unknown[];
  /** Undefined = the table's date format. */
  dateFormat?: DateDisplay;
  datePattern?: string;
  valueMap?: ValueColor[];
  badgeStyle: 'soft' | 'dot' | 'solid';
  icon?: string;
  font?: FontValue;
  wrap: Wrap;
}

/** The cell a column gets when set to Auto: badge columns and value maps → badge, numbers, dates, else text. */
function autoCell(decl: DeclaredColumn, valueMap: ValueColor[] | undefined): TableColumn['cell'] {
  if (decl.type === 'badge' || (valueMap && valueMap.length > 0)) return 'badge';
  if (decl.type === 'number') return 'number';
  if (decl.type === 'date') return 'date';
  return 'text';
}

/**
 * The columns a table shows: the configured ones in their order (a key the query no longer
 * declares is skipped, never shown with an empty header), or every declared column when none is
 * configured. Hidden columns are left out. With no result at all (the empty shape), the configured
 * columns stand on their own settings, as text.
 */
export function tableColumns(slot: SlotData | undefined, settings: Sparse): TableColumn[] {
  const s = settings as TableSettings;
  const declared = declaredColumns(slot);
  const byKey = new Map(declared.map((c) => [c.key, c]));
  const configured = (Array.isArray(s.columns) ? s.columns : []).filter((c) => c && typeof c.key === 'string' && c.key);
  const source: Array<{ decl: DeclaredColumn; cfg: ColumnSetting }> = configured.length
    ? configured.flatMap((cfg) => {
      const decl = byKey.get(cfg.key!) ?? (slot ? undefined : { key: cfg.key!, label: cfg.label?.trim() || cfg.key!, type: 'text' as const });
      return decl ? [{ decl, cfg }] : [];
    })
    : declared.map((decl) => ({ decl, cfg: {} }));
  const seen = new Set<string>();
  const out: TableColumn[] = [];
  for (const { decl, cfg } of source) {
    if (seen.has(decl.key) || cfg.visible === 'hidden') continue;
    seen.add(decl.key);
    // What the source says about the column (unit, decimals, value map) is the default; the placement's own setting wins.
    const ownMap = Array.isArray(cfg.valueMap) && cfg.valueMap.length ? cfg.valueMap : undefined;
    const valueMap = ownMap ?? (valueMapList(decl).length ? valueMapList(decl) : undefined);
    const cell = cfg.cell && cfg.cell !== 'auto' ? cfg.cell : autoCell(decl, valueMap);
    const numeric = cell === 'number' || cell === 'bar' || cell === 'progress';
    out.push({
      key: decl.key,
      label: cfg.label?.trim() || decl.label || decl.key,
      type: cell === 'number' ? 'number' : cell === 'date' ? 'date' : decl.type,
      visible: cfg.visible ?? 'always',
      cell,
      linkTemplate: cfg.linkTemplate || undefined,
      sortable: cfg.sortable !== false,
      align: cfg.align && cfg.align !== 'auto' ? cfg.align : numeric ? 'end' : cell === 'icon' ? 'center' : 'start',
      width: cfg.width ?? 'auto',
      widthPx: cfg.widthPx,
      override: {
        ...metaFormat(decl),
        ...(cfg.unit ? { unit: cfg.unit } : {}),
        ...(typeof cfg.decimals === 'number' ? { decimals: cfg.decimals } : {}),
      },
      color: cfg.color,
      headerColor: cfg.headerColor,
      barMax: typeof cfg.barMax === 'number' ? cfg.barMax : undefined,
      ranges: Array.isArray(cfg.ranges) && cfg.ranges.length ? cfg.ranges : undefined,
      dateFormat: cfg.dateFormat && cfg.dateFormat !== 'inherit' ? cfg.dateFormat : undefined,
      datePattern: cfg.datePattern || undefined,
      valueMap,
      badgeStyle: cfg.badgeStyle ?? 'soft',
      icon: cfg.icon || undefined,
      font: cfg.font && Object.keys(cfg.font).length ? cfg.font : undefined,
      wrap: cfg.wrap ?? 'nowrap',
    });
  }
  // The history preset: the first date column leads, unless the placement ordered its columns itself.
  if (s.historyLayout && !configured.length) {
    const at = out.findIndex((c) => c.type === 'date');
    if (at > 0) out.unshift(...out.splice(at, 1));
  }
  return out;
}

/** A row equal to the one before it on every column but the dates is dropped (history-shaped rows). */
export function dropRepeats(rows: Row[], columns: TableColumn[]): Row[] {
  const keys = columns.filter((c) => c.type !== 'date').map((c) => c.key);
  if (!keys.length) return rows;
  const same = (a: Row, b: Row) => keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
  return rows.filter((row, i) => i === 0 || !same(row, rows[i - 1]));
}

const compareValues = (a: unknown, b: unknown, type: DeclaredColumn['type']): number => {
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  if (type === 'date') {
    const ta = Date.parse(String(a));
    const tb = Date.parse(String(b));
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

/** Rows sorted by a column (empty values last in both directions). Stable; never mutates. */
export function sortRows(rows: Row[], key: string, dir: 'asc' | 'desc', type?: DeclaredColumn['type']): Row[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const ex = x.row[key] === null || x.row[key] === undefined || x.row[key] === '';
      const ey = y.row[key] === null || y.row[key] === undefined || y.row[key] === '';
      if (ex || ey) return ex === ey ? x.i - y.i : ex ? 1 : -1;
      const c = compareValues(x.row[key], y.row[key], type ?? 'text');
      return (dir === 'asc' ? c : -c) || x.i - y.i;
    })
    .map((x) => x.row);
}

/** A flag cell that says yes: true, 1, or the words true / yes / on / 1. */
function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return typeof v === 'string' && ['true', 'yes', 'on', '1'].includes(v.trim().toLowerCase());
}

/** Whether a row matches a colour rule. Numbers compare numerically; text case-insensitively. */
export function ruleMatches(rule: RowRule, row: Row): boolean {
  if (!rule || typeof rule.column !== 'string' || !rule.column) return false;
  if (rule.gateColumn && !truthy(row[rule.gateColumn])) return false;
  const raw = row[rule.column];
  const op = rule.op ?? 'eq';
  const empty = raw === null || raw === undefined || raw === '';
  if (op === 'empty') return empty;
  if (empty) return op === 'ne';
  const text = (typeof raw === 'object' ? JSON.stringify(raw) : String(raw)).trim().toLowerCase();
  const operand = rule.valueFrom === 'column' && rule.valueColumn ? row[rule.valueColumn] : rule.value;
  if (rule.valueFrom === 'column' && (operand === null || operand === undefined || operand === '')) return false;
  const want = (operand === null || operand === undefined ? '' : typeof operand === 'object' ? JSON.stringify(operand) : String(operand)).trim().toLowerCase();
  const a = num(raw);
  const b = num(operand);
  switch (op) {
    case 'ne': return a !== null && b !== null ? a !== b : text !== want;
    case 'gt': return a !== null && b !== null && a > b;
    case 'gte': return a !== null && b !== null && a >= b;
    case 'lt': return a !== null && b !== null && a < b;
    case 'lte': return a !== null && b !== null && a <= b;
    case 'contains': return want !== '' && text.includes(want);
    default: return a !== null && b !== null ? a === b : text === want;
  }
}

/** "Label (unit)" when the column has a unit. */
export function csvHeader(c: TableColumn): string {
  return c.override.unit ? `${c.label} (${c.override.unit})` : c.label;
}

/** The export's cell: the mapped word instead of a raw code, a number at the column's decimals, else the raw text. */
export function csvCell(c: TableColumn, raw: unknown): string {
  const mapped = matchValue(raw, c.valueMap)?.label;
  if (mapped) return mapped;
  const n = num(raw);
  if (n !== null && typeof c.override.decimals === 'number' && c.type === 'number') return n.toFixed(c.override.decimals);
  return rawText(raw);
}


// ── The table's whole description ───────────────────────────────────────────────

/** Row heights (DESIGN.md: 36px rows, compact 28px). */
const ROW_H: Record<NonNullable<TableSettings['density']>, string> = { compact: 'h-7', normal: 'h-9', comfortable: 'h-11' };
const ALIGN: Record<TableColumn['align'], string> = { start: 'text-left', center: 'text-center', end: 'text-right' };
export const JUSTIFY: Record<TableColumn['align'], string> = { start: 'justify-start', center: 'justify-center', end: 'justify-end' };
const WIDTH: Record<TableColumn['width'], string> = { auto: '', narrow: 'w-20', wide: 'min-w-60', px: '' };
const VISIBLE: Record<Visible, string | false> = { always: false, hidden: false, desktop: 'hidden md:table-cell', mobile: 'md:hidden' };
const WRAP: Record<Wrap, string> = { nowrap: 'whitespace-nowrap', truncate: 'max-w-64 truncate', wrap: 'whitespace-normal break-words' };
/** An icon class list a row may name (`fas fa-bolt`). */
const ICON_RE = /^[a-z0-9:-]+(?: [a-z0-9:-]+){0,3}$/i;
const join = (...p: Array<string | false | undefined>) => [...new Set(p.filter(Boolean).join(' ').split(' ').filter(Boolean))].join(' ');

export const LINK_CLASS = 'font-medium text-primary underline-offset-2 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

/** The table's tool, row and pager buttons, and the line icons of its toolbar and headers (16 × 16 drawings). */
export const TOOL_BUTTON = `inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-overlay hover:text-text-primary ${FOCUS}`;
export const ROW_BUTTON = `inline-flex h-6 cursor-pointer items-center rounded-md border border-border px-2 text-xs font-medium text-text-primary hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const PAGE_BUTTON = `inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-secondary hover:bg-surface-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS}`;
export const ICON_SEARCH = 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM14.5 14.5 11 11';
export const ICON_COLUMNS = 'M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11';
export const ICON_PREV = 'M10 3.5 5.5 8l4.5 4.5';
export const ICON_NEXT = 'M6 3.5 10.5 8 6 12.5';
export const ICON_SORT_UP = 'M4.5 9.5 8 6l3.5 3.5';
export const ICON_SORT_DOWN = 'M4.5 6.5 8 10l3.5-3.5';

export type CellContent =
  | { kind: 'dash' }
  | { kind: 'text'; text: string }
  | { kind: 'badge'; label: string; color?: string; icon?: string; variant: 'soft' | 'dot' | 'solid' }
  | { kind: 'icon'; label: string; name?: string; color: string; justify: string }
  | { kind: 'bar'; n: number; max: number; pct: number; color: string; label: string; columnLabel: string; progress: boolean; trackBackground?: string }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'time'; dateTime: string; title: string; text: string };

export interface TableCell {
  key: string;
  className: string;
  style: StyleRecord;
  content: CellContent;
  /** A host cell action wraps the content in a button. */
  clickable: boolean;
  color?: string;
}

export interface TableHeadCell {
  key: string;
  label: string;
  className: string;
  style: StyleRecord;
  ariaSort?: 'ascending' | 'descending';
  /** The viewer can click the header to sort. */
  sortable: boolean;
  dir: 'asc' | 'desc' | null;
  alignEnd: boolean;
}

export interface TableRowModel {
  index: number;
  style: StyleRecord;
  accent?: string;
  /** The row number cell, when row numbers are on. */
  numberCell: { className: string; style: StyleRecord; text: number } | null;
  cells: TableCell[];
  buttonsCell: { className: string; style: StyleRecord } | null;
  raw: Row;
}

export type TableFooter =
  | { kind: 'none' }
  | { kind: 'rowsShown'; text: string }
  | { kind: 'pager'; info: string; page: number; pages: number | null; canNext: boolean; pageOf: string };

export interface TableViewerState {
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  query: string;
  page: number;
  hiddenColumns: string[];
}

export interface TableModelInput {
  settings: Sparse;
  format: ValueFormat;
  rows: SlotData | undefined;
  locale?: string;
  now: number;
  messages: { table: TableTextMessages; common: CommonMessages };
  viewer: TableViewerState;
  /** The host can page the slot on the server AND the result echoes it. */
  paged: boolean;
  /** Row, cell and button actions the host runs. */
  actions?: { interactive: boolean; cellClickColumns: string[]; buttons: Array<{ id: string; label: string }>; hasCellActions: boolean };
  /** Whether an icon name can be drawn by the host (kui-react asks its icon resolver; a server host always can). */
  iconAvailable?: (name: string) => boolean;
}

/** The table messages the model words (the rest are button labels the view draws). */
export type TableTextMessages = Pick<TableMessages, 'noMatches' | 'rowsShown' | 'range' | 'rowCount' | 'pageOf' | 'rowNumber' | 'actions'>;

/**
 * Everything the table draws, decided once and as plain data: the columns the viewer sees, the rows (sorted,
 * searched, paged, history-filtered), each cell's content kind and look, the header, the row colour rules and
 * the footer. `DataTableView.tsx` (React), kui-ejs's `DataTable.ejs` and KUInative draw from it.
 */
export function tableModel(i: TableModelInput) {
  const s = i.settings as TableSettings;
  const { format, locale, now } = i;
  const m = i.messages.table;
  const result = i.rows;
  const echo = result?.paging;
  const paged = i.paged && !!echo;
  const allColumns = tableColumns(result, i.settings);
  const columns = allColumns.filter((c) => !i.viewer.hiddenColumns.includes(c.key));
  // No result at all: the empty shape, the configured headers over no rows, without a search or column picker. A result that declares its columns but
  // carries no row list is the shape too (the card's empty shape keeps the headers its source named, e2e run 1 E18).
  const shapeOnly = (!result || !Array.isArray(result.rows)) && columns.length > 0;
  const textOf = (c: TableColumn, raw: unknown) => cellText(raw, c.type, format, c.override, locale, {
    display: c.dateFormat ?? s.dateFormat ?? 'relative',
    pattern: c.dateFormat ? c.datePattern : s.datePattern,
    now,
    relativeStyle: 'narrow',
  }, i.messages.common);

  const allRows = s.onlyChanges && !paged ? dropRepeats(result?.rows ?? [], allColumns) : result?.rows ?? [];
  const pageSize = Math.max(1, Math.min(100, Number(s.maxRows) || 10));
  const mode = s.paging ?? 'none';

  const prepared = (() => {
    if (paged) return allRows;
    let rows = allRows;
    const q = i.viewer.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => columns.some((c) => {
        const mapped = matchValue(row[c.key], c.valueMap)?.label;
        return (mapped ?? textOf(c, row[c.key])).toLowerCase().includes(q) || rawText(row[c.key]).toLowerCase().includes(q);
      }));
    }
    const sort = i.viewer.sort;
    if (sort) {
      const col = allColumns.find((c) => c.key === sort.key) ?? declaredColumns(result).find((c) => c.key === sort.key);
      rows = sortRows(rows, sort.key, sort.dir, col?.type);
    }
    return rows;
  })();

  const clientPages = !paged && mode === 'pages' ? Math.max(1, Math.ceil(prepared.length / pageSize)) : 1;
  const current = Math.min(i.viewer.page, clientPages);
  const offset = mode === 'pages' && !paged ? (current - 1) * pageSize : 0;
  const rows = paged
    ? prepared
    : mode === 'pages'
      ? prepared.slice(offset, offset + pageSize)
      : mode === 'scroll' ? prepared : prepared.slice(0, pageSize);

  // Bar scales: the largest absolute value per bar column over the loaded rows.
  const barMax: Record<string, number> = {};
  for (const c of allColumns) {
    if (c.cell === 'bar') barMax[c.key] = c.barMax ?? Math.max(0, ...allRows.map((r) => Math.abs(num(r[c.key]) ?? 0)));
    if (c.cell === 'progress') barMax[c.key] = c.barMax ?? 100;
  }

  const actions = i.actions;
  const buttons = actions?.buttons ?? [];
  const cellClickable = (key: string) => !!actions && (actions.cellClickColumns.includes('*') || actions.cellClickColumns.includes(key));
  const rowH = ROW_H[s.density ?? 'normal'] ?? ROW_H.normal;
  const border = cssColor(s.borderColor);
  const edges = s.rangeEdges ?? 'from';
  const lines = s.gridLines ?? 'rows';
  const sticky = s.stickyHeader !== false;
  const rules = Array.isArray(s.rowRules) ? s.rowRules : [];

  // Header: 12px medium secondary on a subtle band (DESIGN.md). A sticky header stays opaque over scrolling rows.
  const headBg = cssColor(s.headerBackground);
  const band = tint('var(--text-primary)', 5)!;
  const headerStyle: StyleRecord = {
    ...fontStyle(s.headerFont, s.headerColor) as StyleRecord,
    ...(headBg
      ? { background: headBg }
      : sticky
        ? { backgroundColor: 'var(--surface-raised)', backgroundImage: `linear-gradient(${band}, ${band})` }
        : { background: band }),
  };
  const cellBorder = join(lines !== 'none' && 'border-b border-border', lines === 'all' && 'border-r last:border-r-0');
  const borderStyle: StyleRecord | undefined = border ? { borderColor: border } : undefined;

  const sortDirOf = (key: string): 'asc' | 'desc' | null => (paged ? (echo!.sort?.key === key ? echo!.sort.dir : null) : i.viewer.sort?.key === key ? i.viewer.sort.dir : null);
  const canSort = (c: TableColumn) => s.sortable !== false && c.sortable && (paged ? echo!.sortable.includes(c.key) : true);
  const rangeColorOf = (c: TableColumn, v: unknown) => cssColor(rangeFor(v, c.ranges ?? s.ranges, edges)?.color);

  const content = (c: TableColumn, row: Row): CellContent => {
    const raw = row[c.key];
    const empty = raw === null || raw === undefined || raw === '';
    const text = textOf(c, raw);
    const n = num(raw);
    if (empty) return { kind: 'dash' };
    const mapped = matchValue(raw, c.valueMap);
    if (c.cell === 'badge') {
      const color = cssColor(mapped?.color) ?? statusColor(raw) ?? (n !== null ? rangeColorOf(c, n) : undefined) ?? cssColor(c.color);
      return { kind: 'badge', label: mapped?.label || text, color, icon: mapped?.icon || undefined, variant: c.badgeStyle };
    }
    if (c.cell === 'icon') {
      const name = mapped?.icon || (typeof raw === 'string' && ICON_RE.test(raw.trim()) && raw.includes('fa-') ? raw.trim() : undefined) || c.icon;
      const color = cssColor(mapped?.color) ?? statusColor(raw) ?? cssColor(c.color) ?? 'var(--text-secondary)';
      return {
        kind: 'icon', label: mapped?.label || text, color, justify: JUSTIFY[c.align],
        name: name && (i.iconAvailable ? i.iconAvailable(name) : true) ? name : undefined,
      };
    }
    if (c.cell === 'bar' || c.cell === 'progress') {
      if (n === null) return { kind: 'text', text };
      const max = barMax[c.key] || 0;
      const pct = max > 0 ? Math.min(100, Math.max(0, (Math.abs(n) / max) * 100)) : 0;
      const color = rangeColorOf(c, n) ?? cssColor(c.color) ?? 'var(--primary)';
      const label = c.cell === 'progress' && !c.override.unit && !format.unit ? `${formatValue(pct, { decimals: 0 }, {}, locale)} %` : text;
      return {
        kind: 'bar', n, max, pct, color, label, columnLabel: c.label, progress: c.cell === 'progress',
        trackBackground: c.cell === 'progress' ? tint(color, 18) : tint('var(--text-primary)', 8),
      };
    }
    if (c.cell === 'link') {
      const href = c.linkTemplate ? expandLinkTemplate(c.linkTemplate, row) : isInternalPath(raw) ? (raw as string) : null;
      if (href) return { kind: 'link', href, text: mapped?.label || text };
    }
    if (c.cell === 'date' || c.type === 'date') {
      const at = toEpoch(raw);
      if (at !== null) return { kind: 'time', dateTime: new Date(at).toISOString(), title: fullDate(at, locale), text };
    }
    return { kind: 'text', text: mapped?.label || text };
  };

  /** A text/number/date cell's colour: its value map, then ranges, then the column colour. */
  const textColor = (c: TableColumn, row: Row): string | undefined => {
    if (c.cell === 'badge' || c.cell === 'bar' || c.cell === 'progress' || c.cell === 'icon') return undefined;
    return cssColor(matchValue(row[c.key], c.valueMap)?.color)
      ?? (c.ranges ? rangeColorOf(c, row[c.key]) : undefined)
      ?? cssColor(c.color);
  };

  const rowLook = (row: Row, idx: number): { style: StyleRecord; accent?: string } => {
    const rule = rules.find((r) => ruleMatches(r, row));
    const ruleColor = rule ? cssColor(rule.color) ?? statusColor(rule.color) : undefined;
    const style: StyleRecord = {};
    let accent: string | undefined;
    if (ruleColor && rule?.target === 'text') style.color = ruleColor;
    else if (ruleColor && rule?.target === 'bar') accent = ruleColor;
    else if (ruleColor) style.background = tint(ruleColor, 12);
    if (!style.background) {
      const byColumn = s.rowColorColumn ? statusColor(row[s.rowColorColumn]) : undefined;
      if (byColumn) style.background = tint(byColumn, 12);
      else if (s.striped && idx % 2 === 1) style.background = cssColor(s.stripeColor) ?? tint('var(--text-primary)', 3);
    }
    return { style, accent };
  };

  const head: TableHeadCell[] = columns.map((c) => {
    const dir = sortDirOf(c.key);
    return {
      key: c.key,
      label: c.label,
      className: join(
        'h-8 whitespace-nowrap px-2 text-xs font-medium text-text-secondary first:rounded-l-md last:rounded-r-md',
        ALIGN[c.align], WIDTH[c.width], VISIBLE[c.visible],
        // The leading timestamp column of the history layout sits above the other sticky headers (one z-index, as tailwind-merge leaves it).
        sticky && 'sticky top-0',
        sticky && !(s.historyLayout && c.key === columns[0]?.key) && 'z-10',
        s.historyLayout && c.key === columns[0]?.key && 'sticky left-0 z-20',
      ),
      style: {
        ...headerStyle,
        ...(cssColor(c.headerColor) ? { color: cssColor(c.headerColor) } : {}),
        ...(c.width === 'px' && c.widthPx ? { width: c.widthPx, minWidth: c.widthPx } : {}),
      },
      ariaSort: dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined,
      sortable: canSort(c),
      dir,
      alignEnd: c.align === 'end',
    };
  });

  const bodyRows: TableRowModel[] = rows.map((row, idx) => {
    const look = rowLook(row, idx);
    return {
      index: idx,
      style: look.style,
      accent: look.accent,
      raw: row,
      numberCell: s.showRowNumbers
        ? {
          className: join(rowH, cellBorder, 'w-8 px-2 text-right text-xs tabular-nums text-text-secondary'),
          style: { ...borderStyle, ...(look.accent ? { boxShadow: `inset 3px 0 0 ${look.accent}` } : {}) },
          text: offset + idx + 1,
        }
        : null,
      cells: columns.map((c, ci) => {
        const color = textColor(c, row);
        return {
          key: c.key,
          color,
          className: join(
            rowH, cellBorder, 'px-2 py-0.5',
            ALIGN[c.align], WIDTH[c.width], VISIBLE[c.visible], WRAP[c.wrap],
            (c.cell === 'number' || c.cell === 'bar' || c.cell === 'progress') && 'tabular-nums',
            ci === 0 && c.cell === 'text' && 'font-medium',
            s.historyLayout && ci === 0 && 'sticky left-0 z-[1]',
          ),
          style: {
            ...(s.historyLayout && ci === 0 ? { backgroundColor: 'var(--surface-raised)' } : {}),
            ...borderStyle,
            ...fontStyle(c.font) as StyleRecord,
            ...(color ? { color } : {}),
            ...(c.width === 'px' && c.widthPx ? { width: c.widthPx, minWidth: c.widthPx, maxWidth: c.widthPx } : {}),
            ...(look.accent && ci === 0 && !s.showRowNumbers ? { boxShadow: `inset 3px 0 0 ${look.accent}` } : {}),
          },
          content: content(c, row),
          clickable: !!actions?.hasCellActions && cellClickable(c.key) && c.cell !== 'link',
        };
      }),
      buttonsCell: buttons.length > 0 ? { className: join(rowH, cellBorder, 'whitespace-nowrap px-2 text-right'), style: { ...borderStyle } } : null,
    };
  });

  let footer: TableFooter = { kind: 'none' };
  if (paged) {
    const total = result?.total;
    const pages = total !== undefined ? Math.max(1, Math.ceil(total / echo!.pageSize)) : null;
    const from = (echo!.page - 1) * echo!.pageSize + 1;
    footer = {
      kind: 'pager',
      info: total !== undefined ? m.range(Math.min(from, total), Math.min(from + allRows.length - 1, total), total) : m.rowCount(allRows.length),
      page: echo!.page, pages, canNext: pages !== null ? echo!.page < pages : allRows.length >= echo!.pageSize,
      pageOf: m.pageOf(echo!.page, pages),
    };
  } else if (mode === 'none' && prepared.length > rows.length) {
    footer = { kind: 'rowsShown', text: m.rowsShown(rows.length, prepared.length) };
  } else if (mode === 'pages' && clientPages > 1) {
    footer = {
      kind: 'pager', info: m.range(offset + 1, offset + rows.length, prepared.length), page: current, pages: clientPages,
      canNext: current < clientPages, pageOf: m.pageOf(current, clientPages),
    };
  }

  return {
    s, allColumns, columns, shapeOnly, head, rows: bodyRows,
    clientSearch: !paged && s.search !== false,
    serverSearch: paged && echo!.searchable && s.search !== false,
    searchQuery: echo?.q,
    /** The text in the search box (a host that keeps the viewer's state, like a server-rendered page, writes it back). */
    searchValue: i.viewer.query,
    /** The column picker's entries, with whether each is shown. */
    pickerColumns: allColumns.map((c) => ({ key: c.key, label: c.label, checked: !i.viewer.hiddenColumns.includes(c.key) })),
    showToolbar: ((!paged && s.search !== false) || (paged && echo!.searchable && s.search !== false) || !!s.columnPicker) && !shapeOnly,
    columnPicker: !!s.columnPicker,
    empty: rows.length === 0 && !shapeOnly,
    emptyText: s.emptyText?.trim() || m.noMatches,
    tableStyle: fontStyle(s.cellFont, s.cellColor) as StyleRecord,
    headerStyle,
    rowNumberHead: s.showRowNumbers
      ? { className: join('h-8 w-8 px-2 text-right text-xs font-medium text-text-secondary first:rounded-l-md', sticky && 'sticky top-0 z-10'), style: headerStyle, label: m.rowNumber }
      : null,
    buttonsHead: buttons.length > 0
      ? { className: join('h-8 px-2 last:rounded-r-md', sticky && 'sticky top-0 z-10'), style: headerStyle, label: m.actions }
      : null,
    rowClass: join('group/row [&:last-child>td]:border-b-0', s.rowHover !== false && 'hover:bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)]', actions?.interactive && 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus'),
    footer,
    offset,
  };
}
