// Vendored from kui-react f7db139: modules/app/WidgetKit/kind.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The contract between a widget type's view and its host (pure types, no React runtime).

import type { ComponentType, ReactNode } from 'react';
import type { ValueFormat } from './settings/style';
import type { SettingsTemplate, Sparse } from './settings/types';
import type { ColumnMeta } from './settings/source-meta';
import type { ScenePatch } from './views/scene-patch';

export type { ColumnMeta, ValueMapEntry, MetaLabel } from './settings/source-meta';
export type { ScenePatch } from './views/scene-patch';

/** One data slot's result: the same shape next-boilerplate's data sources answer with. */
export interface SlotData {
  shape: 'scalar' | 'series' | 'table' | 'record';
  value?: number | string | boolean | null;
  /** What the source says about the value of a scalar (unit, decimals, value map, direction). */
  meta?: ColumnMeta;
  series?: Array<{ name: string; points: Array<{ t: string; v: number }>; meta?: ColumnMeta }>;
  /** A table's columns; a column may carry its own meta (the fields of `ColumnMeta`). */
  columns?: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'badge' } & Omit<ColumnMeta, 'label'>>;
  rows?: Array<Record<string, unknown>>;
  total?: number;
  record?: Record<string, unknown>;
  /** What the source says about each field of a record, by key. */
  recordMeta?: Record<string, ColumnMeta>;
  fetchedAt?: string;
  /** The time window the query ran with (a pinned one may name its own time zone). */
  window?: { explicitTimezone?: string; [key: string]: unknown };
  /** A server-paged table echoes what page it is (next-boilerplate 18.1). */
  paging?: PagedEcho;
}

/** What a server-paged result echoes. */
export interface PagedEcho {
  page: number;
  pageSize: number;
  sortable: string[];
  searchable: boolean;
  sort?: { key: string; dir: 'asc' | 'desc' };
  q?: string;
}

/** A command's confirmation policy, enforced again by the server. */
export interface ControlConfirm {
  mode: 'none' | 'confirm' | 'typed';
  /** The text to type for 'typed', or the question for 'confirm'. */
  text?: string;
}

/** A data slot a widget type declares. */
export interface SlotSpec {
  key: string;
  label: string;
  shape: SlotData['shape'];
  required: boolean;
  /** May be bound to several sources (`<slot>`, `<slot>#2` … `<slot>#8`). */
  repeatable?: boolean;
  /** Slots that share a group are alternatives: the widget is configured once ANY of them is bound (none of them is `required`). */
  anyOf?: string;
}

/** What a control asks its host to do. The host runs the command and checks everything server-side. */
export interface ControlRequest {
  kind: 'run' | 'set';
  value?: unknown;
  /** Present when the command asked for confirmation; the host sends it on so the server checks it again. */
  confirmation?: { confirmed: true; typed?: string };
}

/** What a viewer can do to a symbol of a diagram. `contextMenu` is the right click (or the context-menu key). */
export type ElementGesture = 'click' | 'doubleClick' | 'contextMenu';

export interface ElementActions {
  /** Does this symbol have an action for this gesture? */
  has(gesture: ElementGesture, id: string): boolean;
  /** Run the symbol's actions for this gesture. */
  run(gesture: ElementGesture, id: string): void;
}

export interface WidgetViewProps {
  /** Effective type settings: the template defaults layered under the stored values. */
  settings: Sparse;
  /** Effective `core:format` values (empty for widgets that print no numbers). */
  format: ValueFormat;
  /** Bound results by slot key (`series`, `series#2`, …). */
  data: Record<string, SlotData | undefined>;
  locale?: string;
  /** The data is older than the card's `staleAfterSeconds`. */
  stale?: boolean;
  /** The board is being edited (`PlacementCard`'s `isEditor`): a view may add a hint meant for the person setting it up. */
  editing?: boolean;
  /** Controls only: perform the request (resolves when the host is done; rejects on failure). */
  onControl?: (request: ControlRequest) => Promise<unknown>;
  /** Controls only: the host cannot act (no command bound, no permission). */
  controlDisabledReason?: string;
  /**
   * `control.button` only: the toggle state the host derived (e.g. from a board parameter the press sets).
   * Absent = an ordinary button; `true` / `false` = a toggle, drawn and announced (`aria-pressed`) as such.
   */
  pressed?: boolean;
  /** Map/table/links: build a link for internal navigation; absent = plain anchors. */
  renderLink?: (href: string, children: ReactNode, className?: string) => ReactNode;
  /** Navigate imperatively to an internal path (row and marker clicks). */
  onNavigate?: (href: string) => void;
  /** Rewrite an internal asset path for this host (e.g. prefix a tenant). Absent = as is. */
  resolveUrl?: (url: string) => string;
  /** Board parameters, for `{{param_<key>}}` in texts. */
  params?: Record<string, unknown>;
  /** A clicked element target (markdown `[label](action:<id>)`): the host runs that action. */
  onElementClick?: (id: string) => void;
  /**
   * `chart.pie`: a slice was clicked (or Enter / Space pressed on a focused slice; with this prop every slice is a
   * button). `row` is the table row the slice came from; the folded "Other" slice reports the aggregate
   * `{ <label column>: <other label>, <value column>: <sum> }`. Absent = the slices are plain shapes.
   */
  onSliceClick?: (row: Record<string, unknown>) => void;
  /**
   * `chart.line` / `chart.area` / `chart.bar` on an axis of instants: the viewer brushed a range (a pointer drag across
   * the plot: mouse, pen or touch; on a band axis of timestamps whole bars, to the end of the last one's bucket) or
   * asked for a reset with a double click, or Escape while the band shows (`null`). `from` and `to` are ms since the
   * epoch, `from < to`. Keyboard: the plot is focusable, the arrow keys move the selection's end, Shift + arrows its
   * start, Enter reports it. With this prop the chart's own zoom stands down (the host owns the window); absent = as
   * before, and no band ever appears.
   */
  onRangeSelect?: (range: { from: number; to: number } | null) => void;
  /**
   * `map` and `viewer.model`: a marker was clicked (the map's markers; the viewer's sensor markers and its things, by
   * a click on the shape itself); `row` is the table row it came from. The viewer keeps its tooltip behaviour either
   * way. Absent = no gesture is wired (a thing is then only a picture).
   */
  onMarkerClick?: (row: Record<string, unknown>) => void;
  /**
   * A diagram's symbols and their actions (`scada.scene`): which gestures a symbol answers (the host knows what the
   * placement stored for it) and a way to run them. A symbol with no gesture is not interactive at all.
   */
  elementActions?: ElementActions;
  /**
   * `scada.scene` and `viewer.model`: the scene patch a compute script returned beside its slots (next-boilerplate
   * phase 35, E15; the shape is `views/scene-patch.ts`). Drawing instructions, never an action: things that replace
   * the things table's rows, per-id overrides of symbols, connections, markers and things, extra connections and
   * zones, a view and problems. The view parses it again (`parseScenePatch`, its own caps) and applies it after the
   * authored settings and the rules, so it wins over a rule. Absent = the scene as authored and ruled.
   */
  scenePatch?: ScenePatch;
  /** Controls only: the bound command's confirmation policy. */
  confirm?: ControlConfirm;
  /** The card's title (e.g. an iframe's accessible name). */
  title?: string;
  /** The card's header draws `title`: a caption that only repeats it is not drawn again (`captionOf`). */
  titleShown?: boolean;
}

export interface WidgetKindView {
  View: ComponentType<WidgetViewProps>;
  /** True when the bound data has nothing to show (the card then shows its no-data text). */
  isEmpty?: (data: WidgetViewProps['data'], settings: Sparse) => boolean;
  /**
   * `View` draws a recognisable empty shape from no data (`data = {}`): axes without series, headers
   * without rows, "—" for a value, never a made-up 0. The card then shows that shape, faded, under its
   * no-data text (`$card.emptyDisplay`); a view without it gets the text alone.
   */
  emptyShape?: boolean;
  /** The full-screen view zooms and pans the picture (a process diagram) instead of only showing it larger. */
  zoomable?: boolean;
  /**
   * The content has a height of its own (a value, a state, a control): in a fixed-height cell smaller than it needs, the card draws
   * all of it scaled down to fit (`FitBox`, never under `MIN_FIT_SCALE`) instead of cutting it off under the header.
   */
  fit?: boolean;
  /** CSV rows (first row = header) for the card's download button. */
  toCsv?: (data: WidgetViewProps['data'], settings: Sparse, format: ValueFormat) => string[][];
}

/** A builtin widget type, pure data: what next-boilerplate's catalog and any host need to offer it. */
export interface BuiltinKindSpec {
  /** Stable type key, e.g. 'stat.value'. The template id is `builtin:<type>`. */
  type: string;
  label: string;
  /** Catalog category: Charts, Data, Content, Controls, Gauges & Levels, Maps & Location, Device Controls. */
  category: string;
  description: string;
  /** Font Awesome class for the catalog. */
  icon: string;
  defaultW: number;
  defaultH: number;
  slots: SlotSpec[];
  template: SettingsTemplate;
  /**
   * An optional product group (lower-case id, e.g. `scada`). A host that sells or switches a group on and off (next-boilerplate's
   * `dashboard:widget_kinds`) lists a grouped kind only while something contributes that group; a kind without a group is always offered.
   */
  group?: string;
}
