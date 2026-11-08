// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/data-table.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, itemFormatFields, opt, rangesFields, since } from '../settings/packs';
import type { FieldSchema } from '../_app/SchemaForm/types';
import type { SettingsTemplate, Sparse } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { isInternalPath } from './map';

const RANGE_ITEM: Record<string, FieldSchema> = {
  from: { label: 'From', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
  to: { label: 'To', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
  color: { label: 'Colour', type: 'color', required: true, value: 'var(--success)' },
  label: { label: 'Label', type: 'text', maxLength: 40, placeholder: 'High' },
};

const DATE_OPTIONS = [
  opt('relative', '5m ago'), opt('date', '15 Oct'), opt('time', '14:05'), opt('datetime', '15 Oct 14:05'), opt('custom', 'Custom pattern'),
];
const PATTERN_HELP = 'yyyy yy MMMM MMM MM M EEEE EEE dd d HH H hh h mm ss a; text in \'quotes\' is kept as is. Example: dd.MM.yyyy HH:mm';

/** A value → colour (and label, icon) map for one column. */
const VALUE_MAP_ITEM: Record<string, FieldSchema> = {
  value: { label: 'Value', type: 'text', maxLength: 80, required: true, placeholder: 'Online' },
  color: { label: 'Colour', type: 'color', value: 'var(--success)' },
  label: { label: 'Shown as', type: 'text', maxLength: 60, placeholder: 'The value' },
  icon: { label: 'Icon', type: 'icon', placeholder: 'fas fa-circle-check' },
};

/** Every column link template is an internal path before `{column}` expansion. */
const columnLinksAreInternal = (v: Sparse) =>
  (Array.isArray(v.columns) ? v.columns : []).flatMap((c, i) => {
    const t = c && typeof c === 'object' ? (c as Sparse).linkTemplate : undefined;
    return typeof t === 'string' && t !== '' && !isInternalPath(t)
      ? [{ path: `columns.${i}.linkTemplate`, message: 'The link must be an internal path that starts with a single /' }]
      : [];
  });

/** `data.table`: a bound table with per-column display, viewer sort/search/paging and full styling. */
export const DATA_TABLE: SettingsTemplate = {
  id: 'builtin:data.table',
  version: 1,
  namespace: '',
  label: 'Table',
  format: true,
  exportable: true,
  cardDefaults: { padding: 4, buttons: ['fullscreen', 'export'] },
  groups: [
    { id: 'columns', label: 'Columns', tab: 'Display', since: 1 },
    { id: 'rows', label: 'Rows', tab: 'Display', since: 1 },
    { id: 'viewer', label: 'Viewer tools', tab: 'Display', since: 1 },
    { id: 'dates', label: 'Dates', tab: 'Display', since: 1 },
    { id: 'look', label: 'Look', tab: 'Look', since: 1 },
    { id: 'rowColour', label: 'Row colour', tab: 'Look', since: 1 },
    { id: 'header', label: 'Header', tab: 'Look', since: 1 },
    { id: 'cells', label: 'Cells', tab: 'Look', since: 1 },
    { id: 'colour', label: 'Colour ranges', tab: 'Look', since: 1 },
  ],
  fields: since(1, {
    columns: {
      label: 'Columns', type: 'repeater', group: 'columns', max: 30, value: [],
      description: 'Pick, rename and order the columns the query declares. Empty = all of them, in the query\'s order. A key the query no longer declares is skipped.',
      fields: {
        key: { label: 'Column', type: 'data-key', slot: 'rows', required: true },
        label: { label: 'Header', type: 'text', maxLength: 60, placeholder: 'As declared' },
        visible: {
          label: 'Show', type: 'select', value: 'always', required: true,
          options: [opt('always', 'Always'), opt('desktop', 'Not on phones'), opt('mobile', 'Only on phones'), opt('hidden', 'Hidden')],
        },
        cell: {
          label: 'Cell', type: 'select', value: 'auto', required: true,
          options: [
            opt('auto', 'Auto'), opt('text', 'Text'), opt('number', 'Number'), opt('date', 'Date'), opt('badge', 'Badge'),
            opt('bar', 'Bar'), opt('progress', 'Progress'), opt('link', 'Link'), opt('icon', 'Icon'),
          ],
          description: 'Auto: badge for badge columns or when a value map is set, numbers right-aligned, dates by the date format, else text. Badge: a coloured pill from the value map, or a colour or status word (success, Online, Offline…). Bar: a bar against the largest value. Progress: a bar from 0 to the maximum (100). Link: internal paths only. Icon: the value map\'s icon, or the value when it is an icon name.',
        },
        valueMap: {
          label: 'Value colours', type: 'repeater', max: 30, value: [], fields: { ...VALUE_MAP_ITEM },
          description: 'Maps a value (case does not matter) to a colour, a label and an icon. Badges and icons use it; text cells take its colour.',
        },
        badgeStyle: {
          label: 'Badge style', type: 'select', display: 'segmented', value: 'soft', showIf: { cell: ['badge', 'auto'] },
          options: [opt('soft', 'Tinted'), opt('dot', 'Dot'), opt('solid', 'Solid')],
        },
        icon: { label: 'Default icon', type: 'icon', placeholder: 'fas fa-circle', showIf: { cell: 'icon' }, advanced: true },
        dateFormat: {
          label: 'Date shown as', type: 'select', value: 'inherit', showIf: { cell: ['date', 'auto'] },
          options: [opt('inherit', 'As the table'), ...DATE_OPTIONS],
        },
        datePattern: { label: 'Date pattern', type: 'text', maxLength: 60, placeholder: 'dd.MM.yyyy HH:mm', showIf: { dateFormat: 'custom' }, description: PATTERN_HELP },
        linkTemplate: {
          label: 'Link', type: 'text', maxLength: 300, placeholder: '/admin/devices/{id}', showIf: { cell: 'link' },
          description: 'Internal path only; {column} is replaced by the row\'s value. Empty = the cell value is the path.',
        },
        sortable: { label: 'Sortable', type: 'boolean', value: true, advanced: true },
        align: {
          label: 'Align', type: 'select', display: 'segmented', value: 'auto', advanced: true,
          options: [opt('auto', 'Auto'), opt('start', 'Start'), opt('center', 'Centre'), opt('end', 'End')],
          description: 'Auto: numbers, bars and progress to the end, icons centred, the rest to the start.',
        },
        width: {
          label: 'Width', type: 'select', value: 'auto', advanced: true,
          options: [opt('auto', 'Auto'), opt('narrow', 'Narrow'), opt('wide', 'Wide'), opt('px', 'Fixed (px)')],
        },
        widthPx: { label: 'Width (px)', type: 'number', min: 24, max: 800, value: 120, advanced: true, showIf: { width: 'px' } },
        wrap: {
          label: 'Long text', type: 'select', display: 'segmented', value: 'nowrap', advanced: true,
          options: [opt('nowrap', 'One line'), opt('truncate', 'Cut with …'), opt('wrap', 'Wrap')],
        },
        ...itemFormatFields(),
        font: { label: 'Font', type: 'font', advanced: true },
        color: { label: 'Text colour', type: 'color', advanced: true },
        headerColor: { label: 'Header colour', type: 'color', advanced: true },
        barMax: {
          label: 'Bar maximum', type: 'number', nullable: true, display: 'input', advanced: true, placeholder: 'Largest value / 100',
          showIf: { cell: ['bar', 'progress'] }, description: 'The value of a full bar. Empty = the largest loaded value for Bar, 100 for Progress.',
        },
        ranges: {
          label: 'Colour ranges', type: 'repeater', max: 20, advanced: true, fields: { ...RANGE_ITEM },
          description: 'Bars, progress and badges take the colour of the first range the value falls in (text cells too, when set). Empty = the table\'s ranges.',
        },
      },
    },
    maxRows: {
      label: 'Rows per page', type: 'number', display: 'input', min: 1, max: 100, value: 10, group: 'rows',
      description: 'Rows per page with page buttons, or the most rows shown without them. A query that pages on the server is asked for this many rows per page, up to its own maximum.',
    },
    paging: {
      label: 'More rows', type: 'select', display: 'segmented', value: 'none', group: 'rows', required: true,
      options: [opt('none', 'Cut off'), opt('pages', 'Page buttons'), opt('scroll', 'Scroll all')],
      description: 'Pages through the loaded rows. A query that pages on the server always shows its own pager.',
    },
    defaultSort: { label: 'Sort by', type: 'data-key', slot: 'rows', group: 'rows', placeholder: 'The query\'s order' },
    defaultSortDir: {
      label: 'Direction', type: 'select', display: 'segmented', value: 'desc', group: 'rows', required: true,
      options: [opt('desc', 'Descending'), opt('asc', 'Ascending')],
    },
    showRowNumbers: { label: 'Row numbers', type: 'boolean', value: false, group: 'rows' },
    onlyChanges: {
      label: 'Only rows that changed', type: 'boolean', value: false, group: 'rows', advanced: true,
      description: 'History-shaped rows: a row equal to the one before it (ignoring date columns) is left out. Not for a table the server pages.',
    },
    historyLayout: {
      label: 'Timestamp first, kept in view', type: 'boolean', value: false, group: 'columns', advanced: true,
      description: 'For history-shaped rows: the first date column leads and stays put while the table scrolls sideways.',
    },
    emptyText: { label: 'Text when no row matches', type: 'text', maxLength: 120, placeholder: 'No matching rows.', group: 'rows', advanced: true },
    search: {
      label: 'Search box', type: 'boolean', value: true, group: 'viewer',
      description: 'Filters the loaded rows; for a query that pages on the server, shown when the query supports search.',
    },
    sortable: { label: 'Viewers can sort', type: 'boolean', value: true, group: 'viewer' },
    columnPicker: { label: 'Viewers can hide columns', type: 'boolean', value: false, group: 'viewer' },
    dateFormat: { label: 'Dates shown as', type: 'select', value: 'relative', group: 'dates', required: true, options: DATE_OPTIONS },
    datePattern: { label: 'Date pattern', type: 'text', maxLength: 60, placeholder: 'dd.MM.yyyy HH:mm', group: 'dates', showIf: { dateFormat: 'custom' }, description: PATTERN_HELP },
    density: {
      label: 'Row height', type: 'select', display: 'segmented', value: 'normal', group: 'look', required: true,
      options: [opt('compact', 'Compact (28)'), opt('normal', 'Normal (36)'), opt('comfortable', 'Roomy (44)')],
    },
    gridLines: {
      label: 'Lines', type: 'select', display: 'segmented', value: 'rows', group: 'look', required: true,
      options: [opt('rows', 'Between rows'), opt('all', 'Grid'), opt('none', 'None')],
    },
    rowHover: { label: 'Highlight the row under the pointer', type: 'boolean', value: true, group: 'look', advanced: true },
    stickyHeader: { label: 'Keep the header visible', type: 'boolean', value: true, group: 'look', advanced: true },
    striped: { label: 'Striped rows', type: 'boolean', value: false, group: 'look' },
    stripeColor: colorField('Stripe colour', 'look', undefined, { advanced: true, showIf: { striped: true }, placeholder: 'A faint tint' }),
    borderColor: colorField('Line colour', 'look', 'var(--border)', { advanced: true }),
    rowColorColumn: {
      label: 'Row colour column', type: 'data-key', slot: 'rows', group: 'rowColour', advanced: true,
      description: 'A column holding a colour, a colour name (success, warning, error, info, neutral, primary) or a status word (Online, Offline…) tints the row.',
    },
    rowRules: {
      label: 'Row colour rules', type: 'repeater', group: 'rowColour', max: 20, value: [],
      description: 'The first rule a row matches colours it. Numbers compare as numbers, text ignores case.',
      fields: {
        column: { label: 'Column', type: 'data-key', slot: 'rows', required: true },
        op: {
          label: 'Is', type: 'select', value: 'eq',
          options: [
            opt('eq', 'Equal to'), opt('ne', 'Not equal to'), opt('gt', 'Greater than'), opt('gte', 'At least'),
            opt('lt', 'Less than'), opt('lte', 'At most'), opt('contains', 'Contains'), opt('empty', 'Empty'),
          ],
        },
        valueFrom: {
          label: 'Compared with', type: 'select', display: 'segmented', value: 'value',
          options: [opt('value', 'A value'), opt('column', 'Another column of the row')],
          showIf: { op: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'] },
        },
        value: { label: 'Value', type: 'text', maxLength: 80, showIf: { op: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'], valueFrom: 'value' } },
        valueColumn: {
          label: 'Other column', type: 'data-key', slot: 'rows',
          description: 'For example the level against the row\'s own low threshold.',
          showIf: { op: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'], valueFrom: 'column' },
        },
        gateColumn: {
          label: 'Only when this column is true', type: 'data-key', slot: 'rows', advanced: true,
          description: 'A flag column: the rule is skipped for rows where it is false or empty.',
        },
        color: { label: 'Colour', type: 'color', value: 'var(--warning)' },
        target: {
          label: 'Colours', type: 'select', display: 'segmented', value: 'background',
          options: [opt('background', 'Background'), opt('bar', 'Left bar'), opt('text', 'Text')],
        },
      },
    },
    headerFont: fontField('Header font', 'header', { advanced: true }),
    headerColor: colorField('Header text colour', 'header', 'var(--text-secondary)'),
    headerBackground: colorField('Header background', 'header', undefined, { advanced: true, placeholder: 'A faint band' }),
    cellFont: fontField('Cell font', 'cells', { advanced: true }),
    cellColor: colorField('Cell text colour', 'cells', 'var(--text-primary)', { advanced: true }),
    ...rangesFields('Colours for Bar and Progress cells (on the raw value) when the column has no ranges of its own.', 'colour'),
  }),
  rules: [columnLinksAreInternal],
  migrations: [],
};

export const DATA_TABLE_KIND: BuiltinKindSpec = {
  type: 'data.table',
  label: 'Table',
  category: 'Data',
  description: 'A bound table: pick, rename and style columns, with sort, search and paging for viewers.',
  icon: 'fas fa-table',
  defaultW: 6,
  defaultH: 4,
  slots: [{ key: 'rows', label: 'Rows', shape: 'table', required: true }],
  template: DATA_TABLE,
};
