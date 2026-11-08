// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/data-feed.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, layoutField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

const TIME_OPTIONS = [
  opt('relative', '5 minutes ago'), opt('time', '14:05'), opt('date', '15 Oct'), opt('datetime', '15 Oct 14:05'), opt('custom', 'Custom pattern'),
];

/** `data.feed`: a bound table of events as a timeline, a list, compact lines or cards. */
export const DATA_FEED: SettingsTemplate = {
  id: 'builtin:data.feed',
  version: 1,
  namespace: '',
  label: 'Activity feed',
  format: false,
  exportable: true,
  groups: [
    { id: 'columns', label: 'Columns', tab: 'Data', since: 1 },
    { id: 'severity', label: 'Severity colours', tab: 'Data', since: 1 },
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'feed', label: 'Feed', tab: 'Display', since: 1 },
    { id: 'time', label: 'Time', tab: 'Display', since: 1 },
    { id: 'marker', label: 'Marker', tab: 'Look', since: 1 },
    { id: 'title', label: 'Title', tab: 'Look', since: 1 },
    { id: 'description', label: 'Description', tab: 'Look', since: 1 },
    { id: 'lines', label: 'Lines', tab: 'Look', since: 1 },
  ],
  fields: since(1, {
    timeColumn: { label: 'Time column', type: 'data-key', slot: 'events', value: 'time', required: true, group: 'columns' },
    titleColumn: {
      label: 'Title column', type: 'data-key', slot: 'events', value: 'title', required: true, group: 'columns',
      description: 'A row without a title is not shown.',
    },
    descriptionColumn: { label: 'Description column', type: 'data-key', slot: 'events', value: 'description', group: 'columns' },
    colorColumn: {
      label: 'Severity column', type: 'data-key', slot: 'events', value: 'color', group: 'columns',
      description: 'A column holding a colour, a colour name (success, warning, error, info, neutral, primary), a status word (Critical, Warning, Online…) or a value the severity colours below name.',
    },
    iconColumn: {
      label: 'Icon column', type: 'data-key', slot: 'events', value: 'icon', group: 'columns', advanced: true,
      description: 'A column holding an icon name (fas fa-bolt). Empty values use the severity colour\'s icon or the default icon.',
    },
    valueColors: {
      label: 'Severity colours', type: 'repeater', group: 'severity', max: 20, value: [],
      description: 'Maps a value of the severity column (case does not matter) to a colour and an icon.',
      fields: {
        value: { label: 'Value', type: 'text', maxLength: 80, required: true, placeholder: 'Critical' },
        color: { label: 'Colour', type: 'color', value: 'var(--error)' },
        icon: { label: 'Icon', type: 'icon', placeholder: 'fas fa-circle-exclamation' },
      },
    },
    layout: layoutField([
      opt('timeline', 'Timeline', 'feed-timeline'),
      opt('list', 'List', 'feed-list'),
      opt('compact', 'One line each', 'feed-compact'),
      opt('cards', 'Cards', 'feed-cards'),
    ]),
    order: {
      label: 'Order', type: 'select', display: 'segmented', value: 'newest', group: 'feed', required: true,
      options: [opt('newest', 'Newest first'), opt('oldest', 'Oldest first')],
      description: 'An event whose time cannot be read is always last.',
    },
    maxItems: { label: 'Items shown', type: 'number', display: 'input', min: 1, max: 50, value: 10, group: 'feed' },
    groupByDay: { label: 'Group by day', type: 'boolean', value: false, group: 'feed' },
    timeDisplay: { label: 'Time shown as', type: 'select', group: 'time', value: 'relative', required: true, options: TIME_OPTIONS },
    timePattern: {
      label: 'Time pattern', type: 'text', maxLength: 60, placeholder: 'dd.MM HH:mm', group: 'time', showIf: { timeDisplay: 'custom' },
      description: 'yyyy yy MMMM MMM MM M EEEE EEE dd d HH H hh h mm ss a; text in \'quotes\' is kept as is.',
    },
    timePosition: {
      label: 'Time position', type: 'select', display: 'segmented', value: 'side', group: 'time', required: true,
      options: [opt('side', 'Beside the title'), opt('below', 'Under the text')],
    },
    timeFont: fontField('Time font', 'time', { advanced: true }),
    timeColor: colorField('Time colour', 'time', 'var(--text-secondary)', { advanced: true }),
    indicator: {
      label: 'Severity shown as', type: 'select', display: 'segmented', value: 'dot', group: 'marker', required: true,
      options: [opt('dot', 'Dot'), opt('icon', 'Icon'), opt('bar', 'Left bar'), opt('none', 'Nothing')],
      description: 'Icon: the row\'s icon, the severity colour\'s icon, or the default icon.',
    },
    markerColor: colorField('Marker colour', 'marker', 'var(--text-disabled)', {
      description: 'Used when the row has no severity of its own.',
    }),
    icon: { label: 'Default icon', type: 'icon', group: 'marker', placeholder: 'By severity', advanced: true },
    titleFont: fontField('Title font', 'title', { advanced: true }),
    titleColor: colorField('Title colour', 'title', 'var(--text-primary)'),
    descriptionFont: fontField('Description font', 'description', { advanced: true }),
    descriptionColor: colorField('Description colour', 'description', 'var(--text-secondary)'),
    descriptionLines: {
      label: 'Description lines', type: 'number', display: 'input', min: 0, max: 10, value: 2, group: 'description', advanced: true,
      description: '0 = the whole text.',
    },
    divider: { label: 'Lines between items', type: 'boolean', value: true, group: 'lines', showIf: { layout: ['list', 'compact'] } },
    dividerColor: colorField('Line colour', 'lines', 'var(--border)', { advanced: true, showIf: { layout: ['list', 'compact'] } }),
    lineColor: colorField('Timeline line colour', 'lines', 'var(--border)', { advanced: true, showIf: { layout: 'timeline' } }),
  }),
  migrations: [],
};

export const DATA_FEED_KIND: BuiltinKindSpec = {
  type: 'data.feed',
  label: 'Activity feed',
  category: 'Data',
  description: 'A bound table of events as a timeline, a list, compact lines or cards, coloured by severity.',
  icon: 'fas fa-timeline',
  defaultW: 4,
  defaultH: 5,
  slots: [{ key: 'events', label: 'Events', shape: 'table', required: true }],
  template: DATA_FEED,
};
