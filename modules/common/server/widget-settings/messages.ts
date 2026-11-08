// Vendored from kui-react f7db139: modules/app/WidgetKit/messages.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The texts WidgetKit draws on its own (the card chrome, the board, the settings editor and form,
// the controls, every view), grouped by where they show. A host passes some or all of them as
// `WidgetKitHost.messages` to show them in its language; whatever it leaves out stays English.
//
// Pure: no React and no .tsx import, not even a type-only one. `views/control-common.ts` reads it,
// and next-boilerplate copies that file into a server tree that may hold no component. So every
// group type is defined here, and the views re-export theirs (`TableMessages`, `FeedMessages`).
//
// A text that interpolates is a function of its values. The control texts ControlTile fills itself
// keep its single-brace marks (`{text}`, `{min}`, `{max}`, `{value}`).
//
// Precedence, lowest first: these defaults, the host's `messages`, a placement's own settings (a
// card's "No data" text, a control's feedback texts, a state's "Unknown" label …), explicit props.

import { DEFAULT_SCHEMA_FORM_MESSAGES, mergeSchemaFormMessages, type SchemaFormMessages } from './_app/SchemaForm/messages';
import type { Issue, IssueCode, IssueParams } from './settings/types';

export type { SchemaFormMessages };

/** WidgetCard and PlacementCard: the title row, buttons and body states. */
export interface WidgetCardMessages {
  /** The help button next to the title. */
  about: (title: string) => string;
  oldData: string;
  refresh: string;
  download: string;
  /** The Excel (.xlsx) download button. */
  downloadXlsx: string;
  fullscreen: string;
  loading: string;
  noData: string;
  unconfigured: string;
  error: string;
  retry: string;
  /** The footer; `when` is already formatted ("5 minutes ago", "14:05"). */
  updated: (when: string) => string;
  /** PlacementCard's "unconfigured" text: a required slot is not bound. */
  bindData: string;
  /** The close button of the full-screen view. */
  closeFullscreen: string;
  /** The zoom of a full-screen picture (a process diagram): its toolbar, its buttons and how to use it. */
  zoom: string;
  zoomIn: string;
  zoomOut: string;
  zoomFit: string;
  zoomLevel: (percent: number) => string;
  zoomHint: string;
  /**
   * What a card that threw while it drew leaves in its cell (`FailedPlacementCard`): the heading when the card has no title of its own, the
   * reason's badge and the one-line why.
   */
  failedTitle: string;
  failedLabel: string;
  failedDetail: string;
}

/** WidgetBoard: the toolbar, the edit buttons, the drawers, import and its errors. */
export interface WidgetBoardMessages {
  export: string;
  import: string;
  importFile: string;
  settings: string;
  addWidget: string;
  edit: string;
  done: string;
  settingsOf: (title: string) => string;
  moveLeft: string;
  moveRight: string;
  moveUp: string;
  moveDown: string;
  duplicate: string;
  remove: (title: string) => string;
  empty: string;
  /** The empty board when it can be edited. */
  emptyEditable: string;
  /** The placement settings drawer. */
  placementSettings: (title: string) => string;
  boardTitle: string;
  positionSize: string;
  column: string;
  row: string;
  width: string;
  height: string;
  searchWidgets: string;
  searchWidgetsPlaceholder: string;
  replaceConfirm: (title: string, count: number) => string;
  /** The import confirmation's title, confirm and cancel buttons. */
  replaceTitle: string;
  replaceAction: string;
  replaceCancel: string;
  /** `types` is already joined ("chart.x, chart.y"). */
  skippedTypes: (types: string) => string;
  invalidJson: string;
  notBoard: string;
  newerFormat: (version: string) => string;
  /** `templates` is already joined ("builtin:stat v9, core:card v4"). */
  newerTemplates: (templates: string) => string;
  /** The title of an imported board that has none. */
  defaultTitle: string;
  /** The close button of the board's drawers (placement settings, board settings, the picker). */
  closeDrawer: string;
  /** Board settings: the column count field, each option ("24 columns") and the hint under it. */
  gridCols: string;
  gridColsOption: (count: number) => string;
  gridColsHint: string;
}

/** WidgetSettingsEditor: tabs, the title field, the mode toggle and its notices. */
export interface WidgetEditorMessages {
  tabDisplay: string;
  tabData: string;
  tabCard: string;
  tabActions: string;
  tabLook: string;
  tabToolbar: string;
  tabBehaviour: string;
  title: string;
  advancedOn: string;
  advancedOff: string;
  /** The tab list's accessible name. */
  tabsLabel: string;
  noSettings: string;
  newerVersion: string;
  /** The read-only section of deprecated fields that still hold a value. */
  retired: string;
  /** A deprecated field's note; `replacedBy` is the replacing field's label. */
  retiredNote: (removeIn: number, replacedBy?: string) => string;
}

/**
 * The control views. The reasons a control is disabled and the kit's own labels, plus every text
 * ControlTile, ControlConfirm, ControlSetpoint and ControlButton draw (same keys as their `messages`).
 */
export interface WidgetControlMessages {
  notConnected: string;
  stale: string;
  unknown: string;
  pending: string;
  confirmed: string;
  mismatch: string;
  failed: string;
  readOnly: string;
  retry: string;
  confirmPrompt: string;
  confirm: string;
  cancel: string;
  /** `{text}` is replaced by the text to type. */
  typeToConfirm: string;
  run: string;
  apply: string;
  enterNumber: string;
  /** `{min}` and `{max}` are replaced. */
  outOfRange: string;
  /** `{value}` is replaced. */
  current: string;
  decrease: string;
  increase: string;
  /** A switch's states. */
  on: string;
  off: string;
  unknownLabel: string;
  /** The slider's line with the value the device reports. */
  reported: (value: string) => string;
  /** The slider's accessible name when it has no label. */
  value: string;
  /** The setpoint's accessible name when it has no label and no title. */
  setpoint: string;
  /** The setpoint's current-value caption. */
  now: string;
  /** control.form: its save and reset buttons and its accessible name when it has no label and no title. */
  save: string;
  reset: string;
  form: string;
  /** control.form field errors; `{min}` / `{max}` are replaced. */
  fieldRequired: string;
  fieldNumber: string;
  fieldInvalid: string;
  atLeast: string;
  atMost: string;
  /** control.form: why Save is off while a change is only a clear (the form cannot unset a value). */
  clearedNotSaved: string;
}

export interface TableMessages {
  search: string;
  clearSearch: string;
  columns: string;
  actions: string;
  noMatches: string;
  rowsShown: (shown: number, total: number) => string;
  pageOf: (page: number, pages: number | null) => string;
  rowCount: (count: number) => string;
  /** "1–10 of 42" under a paged table. */
  range: (from: number, to: number, total: number) => string;
  previous: string;
  next: string;
  pager: string;
  rowNumber: string;
  /** Accessible name of the table's scrolling region. */
  table: string;
}

export interface FeedMessages { unknownDay: string }

export interface MapViewMessages {
  loading: string;
  /** The map's accessible name. */
  map: string;
  legend: string;
  layers: string;
  markers: string;
  zones: string;
  routes: string;
  /** A marker tooltip's link (a placement's `linkLabel` wins). */
  open: string;
  /** Route replay: the controls' group name, the buttons, the speed group and the start / end markers. */
  replay: string;
  play: string;
  pause: string;
  speed: string;
  start: string;
  end: string;
  /** The scrub bar's accessible name. */
  position: string;
}

/** The process symbol and scene: the state words a screen reader hears and the diagram's accessible name. */
export interface ScadaMessages {
  idle: string;
  running: string;
  warning: string;
  critical: string;
  /** The scene's accessible name when the card has no title. */
  scene: string;
}

export interface ViewerModelMessages {
  loading: string;
  legend: string;
  /** The viewer's accessible name without a title. */
  region: string;
  noWebgl: string;
  /** `detail` is the error's message (may be empty). */
  startFailed: (detail: string) => string;
  loadingModel: string;
  loadingModels: (done: number, total: number) => string;
  loadFailed: (count: number, detail: string) => string;
  /** `labels` is already joined. */
  notLoaded: (labels: string) => string;
  /** A sensor's value row without a column label. */
  reading: string;
}

export interface ChartViewMessages {
  lineChart: string;
  areaChart: string;
  barChart: string;
  pieChart: string;
  scatterChart: string;
  histogram: string;
  heatmap: string;
  gauge: string;
  /** The donut's centre (a placement's `totalLabel` wins) and a stacked chart's tooltip total row. */
  total: string;
  /** The slice the smallest fold into (a placement's `otherLabel` wins). */
  other: string;
  /** A scatter series without a group. */
  series: string;
  /** The histogram's bars (a placement's `countLabel` wins). */
  count: string;
  mean: (value: string) => string;
  median: (value: string) => string;
  /** A heatmap band without bounds. */
  all: string;
  /** The heatmap's value name (a placement's `valueName` wins). */
  value: string;
  /** The button that leaves a zoomed time range (line and area charts). */
  resetZoom: string;
  /** A gauge's value is over its scale's maximum (the bar stops at the end). */
  aboveScale: string;
  /** A gauge's value is under its scale's minimum. */
  belowScale: string;
  /** While the board is edited: a gauge's value is far off its scale, so the scale is likely wrong. */
  scaleHint: string;
}

export interface ContentViewMessages {
  embedEmpty: string;
  embedRefused: (host: string) => string;
  embedInvalid: string;
  /** The embed's "open in a new tab" link (a placement's `openLabel` wins). */
  open: string;
  /** The link's hidden addition for screen readers. */
  opensInNewTab: (host: string) => string;
  /** The frame's title without a card title. */
  embedTitle: (host: string) => string;
  linksEmpty: string;
  /** Video player: no playable address. */
  videoEmpty: string;
  videoLoading: string;
  videoFailed: (detail: string) => string;
  /** The two addresses of one stream, in the player's quality menu (the bound "Higher quality address" slot). */
  videoQualityStandard: string;
  videoQualityHigh: string;
}

export interface StatViewMessages {
  /** State "since": under a minute. */
  justNow: string;
  forMinutes: (n: number) => string;
  forHours: (n: number) => string;
  forDays: (n: number) => string;
  /** The span a sparkline covers. */
  spanMinutes: (n: number) => string;
  spanHours: (n: number) => string;
  spanDays: (n: number) => string;
  /** A state that matches no rule and has no value (a placement's `unknownLabel` wins). */
  unknown: string;
  /** A state card's words for an on / off value no rule names (a boolean, or 1 / 0 the source calls a boolean). */
  on: string;
  off: string;
  /** Read by screen readers after an old value. */
  stale: string;
  /** The sparkline's accessible name; `span` is null when the span is unknown. */
  trend: (span: string | null, points: number, from: string, to: string) => string;
  min: (value: string) => string;
  max: (value: string) => string;
  latest: (value: string) => string;
  /** Progress: "of 120". */
  of: (target: string) => string;
  /** Progress's accessible text; `target` and `percent` are null when absent. */
  progress: (value: string, target: string | null, percent: string | null) => string;
}

/**
 * A settings issue's text by its `code` (the engine's field checks, the kit's cross-field rules),
 * shown by WidgetSettingsEditor under the field. `label` is the field's label as the editor shows it
 * (the template's own when the field is not found); the English defaults are the issues' `message`s.
 */
export type IssueMessages = { [C in IssueCode]: (label: string, params: IssueParams) => string };

/** Texts more than one view draws. */
export interface CommonMessages {
  yes: string;
  no: string;
}

export interface WidgetKitMessages {
  card: WidgetCardMessages;
  board: WidgetBoardMessages;
  editor: WidgetEditorMessages;
  form: SchemaFormMessages;
  controls: WidgetControlMessages;
  table: TableMessages;
  feed: FeedMessages;
  map: MapViewMessages;
  scada: ScadaMessages;
  viewer: ViewerModelMessages;
  charts: ChartViewMessages;
  content: ContentViewMessages;
  stat: StatViewMessages;
  issues: IssueMessages;
  common: CommonMessages;
}

/** What a host passes: any group, any key; the rest stays English. */
export type WidgetKitMessagesInput = { [G in keyof WidgetKitMessages]?: Partial<WidgetKitMessages[G]> };

export const DEFAULT_WIDGET_KIT_MESSAGES: WidgetKitMessages = {
  card: {
    about: (title) => `About ${title}`,
    oldData: 'Old data',
    refresh: 'Refresh',
    download: 'Download data (CSV)',
    downloadXlsx: 'Download data (Excel)',
    fullscreen: 'Full screen',
    loading: 'Loading',
    noData: 'No data',
    unconfigured: 'Not configured yet.',
    error: 'This widget could not load its data.',
    retry: 'Retry',
    updated: (when) => `Updated ${when}`,
    bindData: 'Bind data to this widget in its settings.',
    closeFullscreen: 'Close dialog',
    zoom: 'Zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomFit: 'Fit to view',
    zoomLevel: (percent) => `Zoom ${percent}%`,
    zoomHint: 'Ctrl + wheel or pinch to zoom; scroll or drag to move.',
    failedTitle: 'This card',
    failedLabel: 'Failed to load',
    failedDetail: 'Something went wrong while this card was drawn. Reload the page to try again.',
  },
  board: {
    export: 'Export',
    import: 'Import',
    importFile: 'Import a dashboard file',
    settings: 'Dashboard settings',
    addWidget: 'Add widget',
    edit: 'Edit',
    done: 'Done',
    settingsOf: (title) => `Settings of ${title}`,
    moveLeft: 'Move left',
    moveRight: 'Move right',
    moveUp: 'Move up',
    moveDown: 'Move down',
    duplicate: 'Duplicate',
    remove: (title) => `Remove ${title}`,
    empty: 'Empty dashboard.',
    emptyEditable: 'Empty dashboard. Press Edit, then Add widget.',
    placementSettings: (title) => `Settings: ${title}`,
    boardTitle: 'Dashboard title',
    positionSize: 'Position and size',
    column: 'Column',
    row: 'Row',
    width: 'Width',
    height: 'Height',
    searchWidgets: 'Search widgets',
    searchWidgetsPlaceholder: 'Search widgets…',
    replaceConfirm: (title, count) => `Replace this dashboard with "${title}" (${count} widgets)?`,
    replaceTitle: 'Replace dashboard',
    replaceAction: 'Replace',
    replaceCancel: 'Cancel',
    skippedTypes: (types) => `Skipped unknown widget types: ${types}`,
    invalidJson: 'This file is not valid JSON.',
    notBoard: 'This file is not a dashboard export.',
    newerFormat: (version) => `This dashboard was exported by a newer version (format ${version}). Update this app to import it.`,
    newerTemplates: (templates) => `This dashboard uses newer widget settings (${templates}). Update this app to import it.`,
    defaultTitle: 'Dashboard',
    closeDrawer: 'Close drawer',
    gridCols: 'Grid columns',
    gridColsOption: (count) => `${count} columns`,
    gridColsHint: 'Changing it rescales every card so it keeps its share of the width; narrow neighbours may move down a row when going to 12.',
  },
  editor: {
    tabDisplay: 'Display',
    tabData: 'Data',
    tabCard: 'Card',
    tabActions: 'Actions',
    tabLook: 'Look',
    tabToolbar: 'Toolbar',
    tabBehaviour: 'Behaviour',
    title: 'Title',
    advancedOn: 'Advanced settings: on',
    advancedOff: 'Advanced settings: off',
    tabsLabel: 'Widget settings',
    noSettings: 'No settings.',
    newerVersion: 'These settings were saved by a newer version of this widget. Editing is disabled until this app is updated.',
    retired: 'No longer used',
    retiredNote: (removeIn, replacedBy) => `No longer used; removed in v${removeIn}.${replacedBy ? ` Replaced by ${replacedBy}.` : ''}`,
  },
  form: DEFAULT_SCHEMA_FORM_MESSAGES,
  controls: {
    notConnected: 'Not connected: no command is set for this control.',
    stale: 'The reading is old, so the control is disabled.',
    unknown: 'The current state is unknown, so the control is disabled.',
    pending: 'Sending…',
    confirmed: 'Done',
    mismatch: 'The device reports a different value.',
    failed: 'The change failed.',
    readOnly: 'You do not have permission to use this control.',
    retry: 'Retry',
    confirmPrompt: 'Are you sure?',
    confirm: 'Confirm',
    cancel: 'Cancel',
    typeToConfirm: 'Type "{text}" to confirm',
    run: 'Run',
    apply: 'Apply',
    enterNumber: 'Enter a number.',
    outOfRange: 'Enter a value between {min} and {max}.',
    current: 'Current: {value}',
    decrease: 'Decrease',
    increase: 'Increase',
    on: 'On',
    off: 'Off',
    unknownLabel: 'Unknown',
    reported: (value) => `Reported: ${value}`,
    value: 'Value',
    setpoint: 'Set point',
    now: 'Now',
    save: 'Save',
    reset: 'Reset',
    form: 'Settings form',
    fieldRequired: 'This field is required.',
    fieldNumber: 'Enter a number.',
    fieldInvalid: 'Choose one of the listed values.',
    atLeast: 'Enter a value of at least {min}.',
    atMost: 'Enter a value of at most {max}.',
    clearedNotSaved: 'An emptied field cannot be saved from here: enter a value or reset.',
  },
  table: {
    search: 'Search',
    clearSearch: 'Clear',
    columns: 'Columns',
    actions: 'Actions',
    noMatches: 'No matching rows.',
    rowsShown: (shown, total) => `Showing ${shown} of ${total} rows`,
    pageOf: (page, pages) => (pages === null ? `Page ${page}` : `Page ${page} of ${pages}`),
    rowCount: (count) => `${count} rows`,
    range: (from, to, total) => `${from}–${to} of ${total}`,
    previous: 'Previous',
    next: 'Next',
    pager: 'Table pages',
    rowNumber: 'Row',
    table: 'Table',
  },
  feed: { unknownDay: 'Time unknown' },
  map: {
    loading: 'Loading map…',
    map: 'Map',
    legend: 'Legend',
    layers: 'Layers',
    markers: 'Markers',
    zones: 'Zones',
    routes: 'Routes',
    open: 'Open',
    replay: 'Route replay',
    play: 'Play',
    pause: 'Pause',
    speed: 'Speed',
    start: 'Start',
    end: 'End',
    position: 'Position on the route',
  },
  scada: { idle: 'Idle', running: 'Running', warning: 'Warning', critical: 'Critical', scene: 'Process diagram' },
  viewer: {
    loading: 'Loading 3D viewer…',
    legend: 'Legend',
    region: '3D model',
    noWebgl: 'This browser cannot show 3D models: WebGL is switched off or not supported.',
    startFailed: (detail) => `The 3D viewer could not start. ${detail}`.trim(),
    loadingModel: 'Loading the model…',
    loadingModels: (done, total) => `Loading models (${done} of ${total})…`,
    loadFailed: (count, detail) => `The model${count > 1 ? 's' : ''} could not be loaded. ${detail}`,
    notLoaded: (labels) => `Not loaded: ${labels}`,
    reading: 'Reading',
  },
  charts: {
    lineChart: 'Line chart',
    areaChart: 'Area chart',
    barChart: 'Bar chart',
    pieChart: 'Pie chart',
    scatterChart: 'Scatter chart',
    histogram: 'Histogram',
    heatmap: 'Heatmap',
    gauge: 'Gauge',
    total: 'Total',
    other: 'Other',
    series: 'Series',
    count: 'Count',
    mean: (value) => `Mean ${value}`,
    median: (value) => `Median ${value}`,
    all: 'All',
    value: 'Value',
    resetZoom: 'Reset zoom',
    aboveScale: 'Above the scale',
    belowScale: 'Below the scale',
    scaleHint: 'Far off the scale: set Minimum and Maximum in the card settings.',
  },
  content: {
    embedEmpty: 'Set a page address in this widget’s settings.',
    embedRefused: (host) => `Pages from ${host} may not be embedded here. An administrator can add the site to the allowed embed sites.`,
    embedInvalid: 'This address cannot be embedded. Use a public https address.',
    open: 'Open',
    opensInNewTab: (host) => `(opens ${host} in a new tab)`,
    embedTitle: (host) => `Embedded page: ${host}`,
    linksEmpty: 'Add links in this widget’s settings.',
    videoEmpty: 'Set a video address in this widget’s settings, or bind one.',
    videoLoading: 'Loading the player…',
    videoFailed: (detail) => `The video player could not start. ${detail}`.trim(),
    videoQualityStandard: 'Standard',
    videoQualityHigh: 'High',
  },
  stat: {
    justNow: 'just now',
    forMinutes: (n) => `for ${n} min`,
    forHours: (n) => `for ${n} h`,
    forDays: (n) => `for ${n} d`,
    spanMinutes: (n) => `${n} min`,
    spanHours: (n) => `${n} h`,
    spanDays: (n) => `${n} d`,
    unknown: 'Unknown',
    on: 'On',
    off: 'Off',
    stale: '(stale)',
    trend: (span, points, from, to) => `Trend${span ? ` over ${span}` : ''}, ${points} points, from ${from} to ${to}`,
    min: (value) => `Min ${value}`,
    max: (value) => `Max ${value}`,
    latest: (value) => `Latest ${value}`,
    of: (target) => `of ${target}`,
    progress: (value, target, percent) => `${value}${target !== null ? ` of ${target}` : ''}${percent ? `, ${percent}` : ''}`,
  },
  issues: {
    boolean: (label) => `${label}: must be on or off`,
    number: (label) => `${label}: must be a number`,
    min: (label, p) => `${label}: must be at least ${p.min}`,
    max: (label, p) => `${label}: must be at most ${p.max}`,
    option: (label) => `${label}: must be one of the options`,
    notOption: (label) => `${label}: is not one of the options`,
    optionList: (label) => `${label}: must be a list of options`,
    unknownOption: (label, p) => `${label}: "${p.option}" is not one of the options`,
    color: (label) => `${label}: is not a colour (use #hex, rgb(), hsl() or a theme colour)`,
    icon: (label) => `${label}: is not an icon name`,
    dataKeys: (label) => `${label}: must be a list of data keys`,
    maxKeys: (label, p) => `${label}: at most ${p.max} keys`,
    dataKey: (label) => `${label}: is not a data key`,
    font: (label) => `${label}: is not a font`,
    list: (label) => `${label}: must be a list`,
    maxItems: (label, p) => `${label}: at most ${p.max} items`,
    text: (label) => `${label}: must be text`,
    maxLength: (label, p) => `${label}: at most ${p.max} characters`,
    url: (label) => `${label}: must be an https/http address or an internal path`,
    required: (label) => `${label} is required`,
    minBelowMax: () => 'Maximum must be greater than minimum',
    linkTarget: (label) => `${label} must be an internal path (/…) or an https, http or mailto address`,
    imageSrc: () => 'The image must be an internal path (/…) or an https or http address',
    embedUrl: () => 'Only a public https address can be embedded (no private hosts, ports or credentials)',
    rowLinkTarget: () => 'Target must be an internal path (/…) or an https, http or mailto address',
    modelUrl: () => 'A model must be an internal path (/…) or an https address',
    positiveStep: () => 'Step must be greater than 0',
    mediaSrc: (label) => `${label} must be an internal path (/…) or an https or http address`,
    subtitleSrc: () => 'A subtitle file must be an internal path (/…) or an https or http address',
  },
  common: { yes: 'Yes', no: 'No' },
};

/**
 * An issue's text in the host's language: its `code`'s message with `label` (the field's label as
 * shown; the issue's own `params.label` without one). An issue without a known code (a host's own
 * rule, an older server) keeps its `message`.
 */
export function issueText(issue: Issue, m: IssueMessages, label?: string): string {
  const code = issue.code;
  if (!code || !Object.prototype.hasOwnProperty.call(m, code)) return issue.message;
  const fn = m[code];
  if (typeof fn !== 'function') return issue.message;
  const params = issue.params && typeof issue.params === 'object' ? issue.params : {};
  return fn(label ?? (typeof params.label === 'string' ? params.label : ''), params);
}

/**
 * The defaults with the host's texts over them, group by group (a shallow merge per group). An
 * `undefined` value keeps the default, so a host may pass a sparse object built from optional texts.
 * Without input the defaults object itself is returned.
 */
export function mergeKitMessages(input?: WidgetKitMessagesInput): WidgetKitMessages {
  if (!input) return DEFAULT_WIDGET_KIT_MESSAGES;
  const out = { ...DEFAULT_WIDGET_KIT_MESSAGES } as Record<string, unknown>;
  for (const group of Object.keys(DEFAULT_WIDGET_KIT_MESSAGES) as Array<keyof WidgetKitMessages>) {
    const over = input[group] as Record<string, unknown> | undefined;
    if (!over) continue;
    if (group === 'form') { out.form = mergeSchemaFormMessages(over as Partial<SchemaFormMessages>); continue; }
    const merged = { ...(DEFAULT_WIDGET_KIT_MESSAGES[group] as unknown as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over)) if (v !== undefined) merged[k] = v;
    out[group] = merged;
  }
  return out as unknown as WidgetKitMessages;
}

/** The control texts ControlTile and its controls take as `messages` (the rest are the kit's own). */
export const CONTROL_TILE_MESSAGE_KEYS = [
  'pending', 'confirmed', 'mismatch', 'failed', 'readOnly', 'retry', 'confirmPrompt', 'confirm', 'cancel',
  'typeToConfirm', 'run', 'apply', 'enterNumber', 'outOfRange', 'current', 'decrease', 'increase',
] as const satisfies ReadonlyArray<keyof WidgetControlMessages>;

/** One reference to a text inside a settings template, for `WidgetKitHost.templateText`. */
export interface TemplateTextRef {
  /** The template's id (`core:card`, `builtin:stat`, `tenant:<type>` …), never the widget type. */
  templateId: string;
  /** A field key, `<repeater>.<sub-field>` for a repeater's field, a group id for `group`, '' for the template. */
  path: string;
  /** `emptyLabel`: a remote-select's empty choice ("The symbols drawn inside this card"). */
  prop: 'label' | 'description' | 'placeholder' | 'emptyLabel' | 'group' | 'option';
  /** The option's stored value, when `prop` is `option`. */
  value?: string;
  /** The English text that shows when the host returns nothing. */
  english: string;
}

/** One reference to a text of a widget type, for `WidgetKitHost.kindText`. */
export interface KindTextRef {
  type: string;
  prop: 'label' | 'description' | 'category' | 'slot';
  /** The slot key, when `prop` is `slot`. */
  key?: string;
  english: string;
}

export type TemplateTextFn = (ref: TemplateTextRef) => string | undefined;
export type KindTextFn = (ref: KindTextRef) => string | undefined;
