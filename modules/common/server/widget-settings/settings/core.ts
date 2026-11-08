// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/settings/core.ts). Kept when kui-react cut its SCADA library; NB changes it itself (docs/phases/07-dashboard/33-scada-and-3d-protection.md, 33.1).
// The common templates every widget shares: the card (`core:card`) and the value format
// (`core:format`); plus the board (`core:board`).

import { colorField, fontField, opt, since } from './packs';
import type { SettingsTemplate, Sparse, WidgetCaps } from './types';

export const CORE_CARD: SettingsTemplate = {
  id: 'core:card',
  version: 1,
  namespace: '$card',
  label: 'Card',
  groups: [
    { id: 'title', label: 'Title', tab: 'Card', since: 1 },
    { id: 'style', label: 'Card style', tab: 'Card', since: 1 },
    { id: 'background', label: 'Background', tab: 'Card', since: 1 },
    { id: 'buttons', label: 'Buttons', tab: 'Card', since: 1 },
    { id: 'dataDisplay', label: 'Data display', tab: 'Data', since: 1, showWhen: { caps: 'hasData' } },
    { id: 'timeWindow', label: 'Time window', tab: 'Data', since: 1, showWhen: { caps: 'windowed' } },
    { id: 'smallScreens', label: 'Small screens', tab: 'Card', since: 1 },
  ],
  fields: since(1, {
    // Title (the title TEXT is the placement's own title, edited above the tabs)
    showTitle: { label: 'Show title', type: 'boolean', value: true, group: 'title' },
    titleFont: fontField('Title font', 'title', { advanced: true, showIf: { showTitle: true } }),
    titleColor: colorField('Title colour', 'title', undefined, { advanced: true, showIf: { showTitle: true } }),
    subtitle: { label: 'Subtitle', type: 'text', maxLength: 120, placeholder: 'Last 7 days', group: 'title', showIf: { showTitle: true } },
    subtitleColor: colorField('Subtitle colour', 'title', undefined, { advanced: true, showIf: { showTitle: true } }),
    titleIcon: { label: 'Title icon', type: 'icon', placeholder: 'fas fa-gauge', group: 'title', showIf: { showTitle: true } },
    titleIconColor: colorField('Title icon colour', 'title', undefined, { advanced: true, showIf: { showTitle: true } }),
    titleIconSize: { label: 'Title icon size (px)', type: 'number', min: 8, max: 64, value: 16, group: 'title', advanced: true, showIf: { showTitle: true } },
    titleTooltip: { label: 'Help text', type: 'text', maxLength: 300, group: 'title', advanced: true, showIf: { showTitle: true },
      description: 'Shown to viewers behind an info icon next to the title.' },

    // Card style
    variant: {
      label: 'Card style', type: 'select', display: 'cards', value: 'raised', group: 'style', required: true,
      options: [opt('raised', 'Raised', 'card-raised'), opt('flat', 'Flat', 'card-flat'), opt('outline', 'Outline', 'card-outline'), opt('plain', 'No frame', 'card-plain')],
    },
    padding: { label: 'Inner spacing (px)', type: 'number', min: 0, max: 64, value: 12, group: 'style' },
    radius: { label: 'Corner radius (px)', type: 'number', min: 0, max: 48, value: 12, group: 'style', advanced: true },
    borderWidth: { label: 'Border width (px)', type: 'number', min: 0, max: 8, group: 'style', advanced: true, placeholder: 'From the style' },
    borderColor: colorField('Border colour', 'style', undefined, { advanced: true }),
    shadow: {
      label: 'Shadow', type: 'select', display: 'segmented', group: 'style', advanced: true, placeholder: 'From the style',
      options: [opt('none', 'None'), opt('sm', 'S'), opt('md', 'M'), opt('lg', 'L')],
    },
    textColor: colorField('Text colour', 'style', undefined, { advanced: true }),

    // Background
    background: {
      label: 'Background', type: 'select', display: 'segmented', value: 'default', group: 'background', required: true,
      options: [opt('default', 'From the style'), opt('color', 'Colour'), opt('image', 'Image'), opt('none', 'Transparent')],
    },
    backgroundColor: colorField('Background colour', 'background', 'var(--surface-raised)', { showIf: { background: ['color', 'image'] } }),
    backgroundImage: { label: 'Image address', type: 'url', maxLength: 2000, placeholder: 'https://… or /uploads/…', group: 'background', showIf: { background: 'image' } },
    backgroundSize: {
      label: 'Image size', type: 'select', display: 'segmented', value: 'cover', group: 'background', showIf: { background: 'image' },
      options: [opt('cover', 'Cover'), opt('contain', 'Contain'), opt('fill', 'Stretch'), opt('auto', 'Original')],
    },
    overlayColor: colorField('Overlay colour', 'background', undefined, { advanced: true, showIf: { background: 'image' },
      description: 'A colour over the image so text stays readable, e.g. rgba(0,0,0,0.4).' }),
    overlayBlur: { label: 'Overlay blur (px)', type: 'number', min: 0, max: 20, value: 0, group: 'background', advanced: true, showIf: { background: 'image' } },

    // Buttons
    buttons: {
      label: 'Card buttons', type: 'multi-select', value: ['fullscreen'], group: 'buttons',
      options: [opt('fullscreen', 'Full screen'), opt('export', 'Download data (CSV)'), opt('refresh', 'Refresh now')],
      description: 'Download appears only on widgets whose data can be exported.',
    },

    // Data display
    noDataText: { label: 'When there is no data', type: 'text', maxLength: 120, placeholder: 'No data', group: 'dataDisplay' },
    emptyDisplay: {
      label: 'Empty widget', type: 'select', value: 'shape', group: 'dataDisplay', required: true,
      options: [opt('shape', 'Show its empty shape with the message'), opt('message', 'Show the message only')],
      description: 'A widget that cannot draw an empty shape always shows the message.',
    },
    showUpdated: {
      label: 'Show last update', type: 'select', value: 'off', group: 'dataDisplay', required: true,
      options: [opt('off', 'Off'), opt('relative', '2 min ago'), opt('time', '14:05'), opt('date', '15 Oct'), opt('datetime', '15 Oct 14:05')],
    },
    staleAfterSeconds: { label: 'Data is old after (seconds)', type: 'number', display: 'input', min: 0, max: 604800, value: 0,
      group: 'dataDisplay', description: '0 = never.' },
    staleDisplay: {
      label: 'When data is old', type: 'select', value: 'badge', group: 'dataDisplay', advanced: true, required: true,
      options: [opt('badge', 'Show an "Old data" badge'), opt('dim', 'Fade the card and show the badge'), opt('hide', 'Show the no-data message')],
    },

    // Time window: purely additive (off by default), so no version bump.
    showWindow: { label: 'Show the time window on the card', type: 'boolean', value: false, group: 'timeWindow',
      description: 'Viewers can pick another window for this card alone, with the same button as the dashboard\'s. Their choice is never saved to the card.' },

    // Small screens
    hideOnMobile: { label: 'Hide on small screens', type: 'boolean', value: false, group: 'smallScreens', advanced: true },
    hideOnDesktop: { label: 'Hide on large screens', type: 'boolean', value: false, group: 'smallScreens', advanced: true },
    mobileOrder: { label: 'Order on small screens', type: 'number', nullable: true, display: 'input', min: 0, max: 999,
      placeholder: 'Grid order', group: 'smallScreens', advanced: true },
    mobileHeight: { label: 'Height on small screens (px)', type: 'number', nullable: true, display: 'input', min: 60, max: 1200,
      placeholder: 'Automatic', group: 'smallScreens', advanced: true },
  }),
  migrations: [],
};

export const CORE_FORMAT: SettingsTemplate = {
  id: 'core:format',
  version: 1,
  namespace: '$format',
  label: 'Value format',
  groups: [{ id: 'format', label: 'Value format', tab: 'Display', since: 1, showWhen: { caps: 'formatsNumbers' } }],
  fields: since(1, {
    unit: { label: 'Unit', type: 'text', maxLength: 16, placeholder: '°C, %, ₺, kWh', group: 'format' },
    decimals: { label: 'Decimals', type: 'number', nullable: true, display: 'input', min: 0, max: 10, placeholder: 'Auto', group: 'format' },
    unitPosition: {
      label: 'Unit position', type: 'select', display: 'segmented', value: 'after', group: 'format', advanced: true, required: true,
      options: [opt('after', 'After (21 °C)'), opt('before', 'Before (₺ 1,249)')],
    },
    notation: {
      label: 'Large numbers', type: 'select', display: 'segmented', value: 'standard', group: 'format', advanced: true, required: true,
      options: [opt('standard', '1,250,000'), opt('compact', '1.25M')],
    },
  }),
  migrations: [],
};

/** Card defaults that depend on what the widget can do (the lowest layer). */
export function platformCardDefaults(caps: WidgetCaps): Sparse {
  return { buttons: caps.hasData ? ['fullscreen'] : [] };
}

export const CORE_BOARD: SettingsTemplate = {
  id: 'core:board',
  version: 1,
  namespace: '',
  label: 'Dashboard',
  groups: [
    { id: 'grid', label: 'Grid', tab: 'Look', since: 1 },
    { id: 'background', label: 'Background', tab: 'Look', since: 1 },
    { id: 'cards', label: 'Card defaults', tab: 'Look', since: 1 },
    { id: 'toolbar', label: 'Toolbar', tab: 'Toolbar', since: 1 },
    { id: 'timeWindow', label: 'Time window for viewers', tab: 'Toolbar', since: 1 },
    { id: 'behaviour', label: 'Behaviour', tab: 'Behaviour', since: 1 },
  ],
  fields: since(1, {
    rowHeight: { label: 'Row height (px)', type: 'number', min: 16, max: 200, value: 40, group: 'grid' },
    gap: { label: 'Gap between cards (px)', type: 'number', min: 0, max: 48, value: 8, group: 'grid' },
    outerMargin: { label: 'Gap around the edge', type: 'boolean', value: false, group: 'grid' },
    autoFillHeight: { label: 'Fill the screen height', type: 'boolean', value: false, group: 'grid',
      description: 'Rows stretch so the board fits the screen (wall displays).' },
    backgroundColor: colorField('Background colour', 'background', undefined, { description: 'Empty = the default canvas colour.' }),
    backgroundImage: { label: 'Background image', type: 'url', maxLength: 2000, group: 'background', placeholder: 'https://… or /uploads/…' },
    backgroundSize: {
      label: 'Image size', type: 'select', display: 'segmented', value: 'cover', group: 'background',
      options: [opt('cover', 'Cover'), opt('contain', 'Contain'), opt('fill', 'Stretch'), opt('auto', 'Original')],
    },
    cardVariant: {
      label: 'Card style', type: 'select', display: 'cards', group: 'cards', placeholder: 'Widget default',
      options: [opt('raised', 'Raised', 'card-raised'), opt('flat', 'Flat', 'card-flat'), opt('outline', 'Outline', 'card-outline'), opt('plain', 'No frame', 'card-plain')],
    },
    cardBackgroundColor: colorField('Card background', 'cards'),
    cardTextColor: colorField('Card text colour', 'cards'),
    cardRadius: { label: 'Card corner radius (px)', type: 'number', min: 0, max: 48, group: 'cards', nullable: true },
    cardPadding: { label: 'Card inner spacing (px)', type: 'number', min: 0, max: 64, group: 'cards', nullable: true },
    showTitle: { label: 'Show the dashboard title', type: 'boolean', value: true, group: 'toolbar' },
    titleColor: colorField('Title colour', 'toolbar'),
    toolbar: {
      label: 'Toolbar items', type: 'multi-select', group: 'toolbar',
      value: ['timeWindow', 'params', 'fullscreen', 'refresh', 'export'],
      options: [opt('timeWindow', 'Time window'), opt('params', 'Parameters'), opt('fullscreen', 'Full screen'), opt('refresh', 'Refresh'), opt('export', 'Export')],
    },
    // What a viewer may change in the time window (ThingsBoard's "hide" options, finer): purely additive, so no version bump.
    windowTabs: {
      label: 'Window kinds viewers can pick', type: 'multi-select', group: 'timeWindow',
      value: ['realtime', 'history'],
      options: [opt('realtime', 'Realtime'), opt('history', 'History')],
    },
    windowControls: {
      label: 'Window settings viewers can change', type: 'multi-select', group: 'timeWindow',
      value: ['interval', 'aggregation', 'timezone'],
      options: [opt('interval', 'Grouping interval'), opt('aggregation', 'Aggregation'), opt('timezone', 'Time zone')],
    },
    windowAggregations: {
      label: 'Aggregations viewers can pick', type: 'multi-select', group: 'timeWindow',
      value: ['avg', 'min', 'max', 'sum', 'count', 'none'],
      options: [opt('avg', 'Average'), opt('min', 'Minimum'), opt('max', 'Maximum'), opt('sum', 'Sum'), opt('count', 'Count'), opt('none', 'None (raw values)')],
    },
    defaultRefreshSeconds: { label: 'Refresh every (seconds)', type: 'number', nullable: true, min: 5, max: 86400, group: 'behaviour',
      placeholder: 'Never', description: 'Cards without their own refresh interval use this.' },
  }),
  migrations: [],
};

/** Board `cardDefaults` keys → the `$card` keys they set. */
export const BOARD_CARD_DEFAULTS: Record<string, string> = {
  cardVariant: 'variant',
  cardBackgroundColor: 'backgroundColor',
  cardTextColor: 'textColor',
  cardRadius: 'radius',
  cardPadding: 'padding',
};

/** The `$card` layer a board contributes (below the widget type's and the placement's). */
export function boardCardLayer(board: Sparse | null | undefined): Sparse {
  const out: Sparse = {};
  if (!board) return out;
  for (const [from, to] of Object.entries(BOARD_CARD_DEFAULTS)) {
    if (board[from] !== undefined && board[from] !== null && board[from] !== '') out[to] = board[from];
  }
  if (out.backgroundColor !== undefined) out.background = 'color';
  return out;
}
