// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/stat-attributes.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, itemFormatFields, labelStyleFields, layoutField, opt, since, valueStyleFields } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `stat.attributes`: a bound record as label / value rows. */
export const STAT_ATTRIBUTES: SettingsTemplate = {
  id: 'builtin:stat.attributes',
  version: 1,
  namespace: '',
  label: 'Attributes',
  format: true,
  exportable: true,
  // Empty decimals = automatic: 17.4, 1,284, 2.75.
  formatDefaults: {},
  cardDefaults: { buttons: ['fullscreen', 'export'] },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'fields', label: 'Fields', tab: 'Data', since: 1 },
    { id: 'label', label: 'Labels', tab: 'Display', since: 1 },
    { id: 'value', label: 'Values', tab: 'Display', since: 1 },
    { id: 'rows', label: 'Rows', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('list', 'List', 'attributes-list'),
      opt('grid-2', 'Two columns', 'attributes-grid-2'),
      opt('grid-3', 'Three columns', 'attributes-grid-3'),
      opt('columns', 'One row', 'attributes-columns'),
    ]),
    alignment: {
      label: 'Values', type: 'select', display: 'segmented', value: 'split', group: 'layout', required: true,
      options: [opt('split', 'Label left, value right'), opt('start', 'Aligned left'), opt('center', 'Centred')],
      description: 'In the grid layouts "label left, value right" reads as aligned left.',
    },
    fields: {
      label: 'Fields', type: 'repeater', group: 'fields', max: 50,
      description: 'Which keys to show, in order. Leave empty to show every key of the record.',
      fields: {
        key: { label: 'Record key', type: 'data-key', slot: 'record', required: true },
        label: { label: 'Label', type: 'text', maxLength: 60, placeholder: 'The key, humanised' },
        ...itemFormatFields(),
        icon: { label: 'Icon', type: 'icon', placeholder: 'fas fa-microchip' },
        color: { label: 'Value colour', type: 'color' },
        ranges: {
          label: 'Colour ranges', type: 'repeater', max: 10, advanced: true,
          description: 'The first range the value falls in colours it (over the value colour).',
          fields: {
            from: { label: 'From', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
            to: { label: 'To', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
            color: { label: 'Colour', type: 'color', required: true, value: 'var(--warning)' },
          },
        },
      },
    },
    ...labelStyleFields('label'),
    showIcons: { label: 'Field icons', type: 'boolean', value: true, group: 'label', advanced: true },
    ...valueStyleFields('value'),
    maxRows: { label: 'Max rows', type: 'number', min: 1, max: 50, value: 20, group: 'rows' },
    emptyValue: { label: 'Shown for an empty value', type: 'text', maxLength: 20, value: '—', group: 'rows', advanced: true },
    dividers: { label: 'Lines between rows', type: 'boolean', value: true, group: 'rows' },
    dividerColor: colorField('Line colour', 'rows', undefined, { advanced: true, showIf: { dividers: true } }),
    striped: { label: 'Striped rows', type: 'boolean', value: false, group: 'rows' },
  }),
  migrations: [],
};

export const STAT_ATTRIBUTES_KIND: BuiltinKindSpec = {
  type: 'stat.attributes',
  label: 'Attributes',
  category: 'Data',
  description: 'A bound record as a label / value list or a grid of small figures.',
  icon: 'fas fa-list-ul',
  defaultW: 3,
  defaultH: 3,
  slots: [{ key: 'record', label: 'Record', shape: 'record', required: true }],
  template: STAT_ATTRIBUTES,
};
