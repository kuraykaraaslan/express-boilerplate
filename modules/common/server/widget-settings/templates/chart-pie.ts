// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/chart-pie.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, legendFields, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `chart.pie`: a bound table (label, value) as proportional slices; pie, donut or donut with the total. */
export const CHART_PIE: SettingsTemplate = {
  id: 'builtin:chart.pie',
  version: 1,
  namespace: '',
  label: 'Pie chart',
  format: true,
  exportable: true,
  formatDefaults: {},
  groups: [
    { id: 'data', label: 'Columns', tab: 'Data', since: 1 },
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'slices', label: 'Slices', tab: 'Display', since: 1 },
    { id: 'colours', label: 'Slice colours', tab: 'Display', since: 1 },
    { id: 'labels', label: 'Slice labels', tab: 'Display', since: 1 },
    { id: 'legend', label: 'Legend', tab: 'Display', since: 1 },
    { id: 'tooltip', label: 'Tooltip', tab: 'Display', since: 1 },
    { id: 'behaviour', label: 'Animation', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    labelColumn: { label: 'Label column', type: 'data-key', slot: 'slices', value: 'label', placeholder: 'label', group: 'data', required: true },
    valueColumn: { label: 'Value column', type: 'data-key', slot: 'slices', value: 'value', placeholder: 'value', group: 'data', required: true },
    layout: {
      label: 'Layout', type: 'select', display: 'cards', value: 'pie', group: 'layout', required: true,
      options: [opt('pie', 'Pie', 'pie-pie'), opt('donut', 'Donut', 'pie-donut'), opt('donut-total', 'Donut with total', 'pie-donut-total')],
    },
    totalLabel: { label: 'Caption under the total', type: 'text', maxLength: 30, placeholder: 'Total', group: 'layout', showIf: { layout: 'donut-total' } },
    donutWidth: { label: 'Ring thickness (%)', type: 'number', min: 10, max: 90, value: 40, group: 'layout', showIf: { layout: ['donut', 'donut-total'] } },
    startAngle: { label: 'Start angle (°, clockwise from 12 o\'clock)', type: 'number', min: 0, max: 359, value: 0, group: 'layout', advanced: true },
    sliceGap: { label: 'Gap between slices (px)', type: 'number', min: 0, max: 8, value: 2, group: 'layout', advanced: true },
    maxSlices: { label: 'Most slices', type: 'number', min: 2, max: 20, value: 8, group: 'slices', description: 'The smallest of the rest fold into one "Other" slice.' },
    otherLabel: { label: 'Name of the folded slice', type: 'text', maxLength: 30, placeholder: 'Other', group: 'slices', advanced: true },
    sort: {
      label: 'Order', type: 'select', display: 'segmented', value: 'desc', group: 'slices', required: true,
      options: [opt('desc', 'Largest first'), opt('asc', 'Smallest first'), opt('none', 'As the data')],
    },
    valueLabels: {
      label: 'Text on slices', type: 'select', value: 'percent', group: 'labels', required: true,
      options: [opt('none', 'Off'), opt('percent', 'Share'), opt('value', 'Value'), opt('name', 'Name'), opt('name-percent', 'Name and share')],
      description: 'Slices under 4 % stay unlabelled.',
    },
    labelPosition: {
      label: 'Position', type: 'select', display: 'segmented', value: 'inside', group: 'labels', required: true,
      options: [opt('inside', 'On the slice'), opt('outside', 'Outside, with a line')],
      showIf: { valueLabels: ['percent', 'value', 'name', 'name-percent'] },
    },
    labelFont: fontField('Label font', 'labels', { advanced: true }),
    labelColor: colorField('Label colour', 'labels', undefined, { advanced: true, description: 'Empty = white on the slice, the text colour outside.' }),
    colors: {
      label: 'Slice colours', type: 'repeater', group: 'colours', max: 30, advanced: true,
      description: 'Pin a colour to a slice by its label; other slices use the theme palette.',
      fields: {
        key: { label: 'Slice label', type: 'data-key', slot: 'slices', required: true },
        color: { label: 'Colour', type: 'color', required: true, value: 'var(--primary)' },
      },
    },
    ...legendFields('legend', 'auto', false),
    legendValue: {
      label: 'After each name', type: 'select', display: 'segmented', value: 'none', group: 'legend', advanced: true, required: true,
      options: [opt('none', 'Nothing'), opt('value', 'Value'), opt('percent', 'Share')],
    },
    showTooltip: { label: 'Tooltip on hover', type: 'boolean', value: true, group: 'tooltip' },
    tooltipValue: {
      label: 'Tooltip shows', type: 'select', display: 'segmented', value: 'both', group: 'tooltip', required: true, showIf: { showTooltip: true },
      options: [opt('both', 'Value and share'), opt('value', 'Value'), opt('percent', 'Share')],
    },
    animate: { label: 'Animate on load', type: 'boolean', value: true, group: 'behaviour' },
  }),
  migrations: [],
};

export const CHART_PIE_KIND: BuiltinKindSpec = {
  type: 'chart.pie',
  label: 'Pie chart',
  category: 'Charts',
  description: 'A bound table (label, value) as proportional slices, optionally a donut.',
  icon: 'fas fa-chart-pie',
  defaultW: 4,
  defaultH: 5,
  slots: [{ key: 'slices', label: 'Slices', shape: 'table', required: true }],
  template: CHART_PIE,
};

