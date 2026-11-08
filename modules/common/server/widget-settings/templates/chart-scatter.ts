// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/chart-scatter.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { axisFields, colorField, legendFields, minBelowMax, opt, since, thresholdsField } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/**
 * `chart.scatter`: a bound table (x, y, optional group) as points; one series per group (up to 8).
 * Not `format`: the two axes print different quantities, so each axis has its own unit and decimals.
 */
export const CHART_SCATTER: SettingsTemplate = {
  id: 'builtin:chart.scatter',
  version: 1,
  namespace: '',
  label: 'Scatter chart',
  format: false,
  exportable: true,
  groups: [
    { id: 'data', label: 'Columns', tab: 'Data', since: 1 },
    { id: 'points', label: 'Points', tab: 'Display', since: 1 },
    { id: 'trend', label: 'Trend line', tab: 'Display', since: 1 },
    { id: 'axis', label: 'Axes', tab: 'Display', since: 1 },
    { id: 'legend', label: 'Legend', tab: 'Display', since: 1 },
    { id: 'tooltip', label: 'Tooltip', tab: 'Display', since: 1 },
    { id: 'thresholds', label: 'Thresholds', tab: 'Display', since: 1 },
    { id: 'behaviour', label: 'Animation', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    xColumn: { label: 'X column', type: 'data-key', slot: 'points', value: 'x', placeholder: 'x', group: 'data', required: true },
    yColumn: { label: 'Y column', type: 'data-key', slot: 'points', value: 'y', placeholder: 'y', group: 'data', required: true },
    groupColumn: { label: 'Group column', type: 'data-key', slot: 'points', group: 'data', description: 'One series per distinct value (up to 8).' },
    pointColor: colorField('Point colour', 'points', 'var(--primary)', { description: 'With a group column, groups use the theme palette unless pinned below.' }),
    pointSize: {
      label: 'Point size', type: 'select', display: 'segmented', value: 'md', group: 'points', required: true,
      options: [opt('sm', 'S'), opt('md', 'M'), opt('lg', 'L'), opt('xl', 'XL')],
    },
    pointShape: {
      label: 'Point shape', type: 'select', display: 'segmented', value: 'circle', group: 'points', required: true,
      options: [opt('circle', 'Circle'), opt('square', 'Square'), opt('diamond', 'Diamond'), opt('triangle', 'Triangle')],
    },
    pointOpacity: { label: 'Point opacity', type: 'number', min: 0.1, max: 1, step: 0.05, value: 0.8, group: 'points', advanced: true },
    groupColors: {
      label: 'Group colours', type: 'repeater', group: 'points', max: 8, advanced: true,
      fields: {
        key: { label: 'Group', type: 'data-key', slot: 'points', required: true },
        color: { label: 'Colour', type: 'color', required: true, value: 'var(--primary)' },
      },
    },
    trendLine: { label: 'Trend line (least squares) per group', type: 'boolean', value: false, group: 'trend' },
    trendColor: colorField('Trend line colour', 'trend', undefined, { advanced: true, showIf: { trendLine: true }, description: 'Empty = the group\'s colour.' }),
    ...axisFields('axis', true),
    showXAxis: { label: 'X axis labels', type: 'boolean', value: true, group: 'axis' },
    showYAxis: { label: 'Y axis labels', type: 'boolean', value: true, group: 'axis' },
    yTickCount: { label: 'Y ticks (about)', type: 'number', nullable: true, display: 'input', min: 2, max: 10, placeholder: '4', group: 'axis', advanced: true },
    gridStyle: {
      label: 'Grid line', type: 'select', display: 'segmented', value: 'dashed', group: 'axis', advanced: true, required: true, showIf: { showGrid: true },
      options: [opt('dashed', 'Dashed'), opt('dotted', 'Dotted'), opt('solid', 'Solid')],
    },
    xUnit: { label: 'X unit', type: 'text', maxLength: 16, group: 'axis', advanced: true },
    xDecimals: { label: 'X decimals', type: 'number', nullable: true, display: 'input', min: 0, max: 10, placeholder: 'Auto', group: 'axis', advanced: true },
    yUnit: { label: 'Y unit', type: 'text', maxLength: 16, group: 'axis', advanced: true },
    yDecimals: { label: 'Y decimals', type: 'number', nullable: true, display: 'input', min: 0, max: 10, placeholder: 'Auto', group: 'axis', advanced: true },
    ...legendFields('legend', 'auto', false),
    showTooltip: { label: 'Tooltip on hover', type: 'boolean', value: true, group: 'tooltip' },
    tooltipTime: { label: 'Show the x value as the heading', type: 'boolean', value: true, group: 'tooltip', advanced: true, showIf: { showTooltip: true } },
    ...thresholdsField('thresholds'),
    animate: { label: 'Animate on load', type: 'boolean', value: true, group: 'behaviour' },
  }),
  rules: [minBelowMax('xMin', 'xMax'), minBelowMax('yMin', 'yMax')],
  migrations: [],
};

export const CHART_SCATTER_KIND: BuiltinKindSpec = {
  type: 'chart.scatter',
  label: 'Scatter chart',
  category: 'Charts',
  description: 'A bound table (x, y, optional group) as points.',
  icon: 'fas fa-braille',
  defaultW: 6,
  defaultH: 5,
  slots: [{ key: 'points', label: 'Points', shape: 'table', required: true }],
  template: CHART_SCATTER,
};
