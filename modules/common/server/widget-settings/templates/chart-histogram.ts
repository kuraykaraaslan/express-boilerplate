// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/chart-histogram.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { axisFields, colorField, fontField, minBelowMax, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `chart.histogram`: the distribution of one numeric column of a bound table, in equal-width bins. */
export const CHART_HISTOGRAM: SettingsTemplate = {
  id: 'builtin:chart.histogram',
  version: 1,
  namespace: '',
  label: 'Histogram',
  format: true,
  exportable: true,
  formatDefaults: {},
  groups: [
    { id: 'data', label: 'Column', tab: 'Data', since: 1 },
    { id: 'bins', label: 'Bins', tab: 'Display', since: 1 },
    { id: 'bars', label: 'Bars', tab: 'Display', since: 1 },
    { id: 'markers', label: 'Mean and median', tab: 'Display', since: 1 },
    { id: 'axis', label: 'Axis', tab: 'Display', since: 1 },
    { id: 'tooltip', label: 'Tooltip', tab: 'Display', since: 1 },
    { id: 'behaviour', label: 'Animation', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    valueColumn: { label: 'Value column', type: 'data-key', slot: 'values', value: 'value', placeholder: 'value', group: 'data', required: true },
    bins: { label: 'Bins', type: 'number', nullable: true, display: 'input', min: 1, max: 50, placeholder: 'Automatic', group: 'bins',
      description: 'Empty = chosen from the number of values.' },
    min: { label: 'Range minimum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group: 'bins' },
    max: { label: 'Range maximum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group: 'bins' },
    binEdges: {
      label: 'Bin edges', type: 'select', display: 'segmented', value: 'nice', group: 'bins', required: true,
      options: [opt('nice', 'Round numbers'), opt('exact', 'Exactly min to max')],
      description: 'Round numbers give edges like 100, 150, 200; the bin count may then differ by one.',
    },
    barColor: colorField('Bar colour', 'bars', 'var(--primary)'),
    barWidth: { label: 'Bar width (% of the bin)', type: 'number', min: 50, max: 100, step: 2, value: 92, group: 'bars', advanced: true },
    barRadius: { label: 'Corner radius (px)', type: 'number', min: 0, max: 12, value: 3, group: 'bars', advanced: true },
    valueLabels: {
      label: 'Value labels', type: 'select', display: 'segmented', value: 'none', group: 'bars', required: true,
      options: [opt('none', 'Off'), opt('value', 'Count on each bar')],
    },
    valueLabelPosition: {
      label: 'Position', type: 'select', display: 'segmented', value: 'outside', group: 'bars', required: true, showIf: { valueLabels: 'value' },
      options: [opt('outside', 'Above the bar'), opt('inside', 'Inside the top')],
    },
    valueLabelFont: fontField('Label font', 'bars', { advanced: true, showIf: { valueLabels: 'value' } }),
    valueLabelColor: colorField('Label colour', 'bars', undefined, { advanced: true, showIf: { valueLabels: 'value' } }),
    countLabel: { label: 'Name of the count', type: 'text', maxLength: 30, placeholder: 'Count', group: 'bars', advanced: true },
    showMean: { label: 'Mark the mean', type: 'boolean', value: false, group: 'markers' },
    showMedian: { label: 'Mark the median', type: 'boolean', value: false, group: 'markers' },
    markerColor: colorField('Marker colour', 'markers', undefined, { advanced: true, description: 'Empty = the text colour.' }),
    ...axisFields('axis'),
    xLabel: { label: 'X axis title', type: 'text', maxLength: 40, group: 'axis', advanced: true },
    showXAxis: { label: 'Bin edge labels', type: 'boolean', value: true, group: 'axis' },
    showYAxis: { label: 'Count labels', type: 'boolean', value: true, group: 'axis' },
    yTickCount: { label: 'Count ticks (about)', type: 'number', nullable: true, display: 'input', min: 2, max: 10, placeholder: '4', group: 'axis', advanced: true },
    gridStyle: {
      label: 'Grid line', type: 'select', display: 'segmented', value: 'dashed', group: 'axis', advanced: true, required: true, showIf: { showGrid: true },
      options: [opt('dashed', 'Dashed'), opt('dotted', 'Dotted'), opt('solid', 'Solid')],
    },
    showTooltip: { label: 'Tooltip on hover', type: 'boolean', value: true, group: 'tooltip' },
    tooltipTime: { label: 'Show the bin range as the heading', type: 'boolean', value: true, group: 'tooltip', advanced: true, showIf: { showTooltip: true } },
    animate: { label: 'Animate on load', type: 'boolean', value: true, group: 'behaviour' },
  }),
  rules: [minBelowMax('min', 'max'), minBelowMax('yMin', 'yMax')],
  migrations: [],
};

export const CHART_HISTOGRAM_KIND: BuiltinKindSpec = {
  type: 'chart.histogram',
  label: 'Histogram',
  category: 'Charts',
  description: 'The distribution of one numeric column of a bound table, in equal-width bins.',
  icon: 'fas fa-chart-simple',
  defaultW: 6,
  defaultH: 4,
  slots: [{ key: 'values', label: 'Values', shape: 'table', required: true }],
  template: CHART_HISTOGRAM,
};
