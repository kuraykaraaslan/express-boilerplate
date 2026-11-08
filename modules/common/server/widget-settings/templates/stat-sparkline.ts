// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/stat-sparkline.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, iconFields, layoutField, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `stat.sparkline`: the latest value of a series with its trend line and change badge. */
export const STAT_SPARKLINE: SettingsTemplate = {
  id: 'builtin:stat.sparkline',
  version: 1,
  namespace: '',
  label: 'Stat with trend',
  format: true,
  directionField: 'increaseIs',
  exportable: false,
  formatDefaults: { decimals: 0 },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'value', label: 'Value', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'icon', label: 'Icon', tab: 'Display', since: 1 },
    { id: 'trend', label: 'Trend line', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Colour ranges', tab: 'Display', since: 1 },
    { id: 'change', label: 'Change', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('stacked', 'Line above the number', 'spark-stacked'),
      opt('value-top', 'Number above the line', 'spark-value-top'),
      opt('inline', 'Number beside the line', 'spark-inline'),
      opt('overlay', 'Line behind the number', 'spark-overlay'),
      opt('chart-only', 'Line only', 'spark-chart-only'),
    ]),
    autoScale: { label: 'Scale the number to the card', type: 'boolean', value: true, group: 'value' },
    valueFont: fontField('Value font', 'value', { showIf: { autoScale: false } }),
    valueColor: colorField('Value colour', 'value', 'var(--text-primary)'),
    label: { label: 'Label', type: 'text', maxLength: 80, placeholder: 'Above the line', group: 'label' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    ...iconFields('icon', 'var(--primary)', 20),
    iconBackground: colorField('Icon background', 'icon', undefined, { advanced: true }),
    curve: {
      label: 'Line shape', type: 'select', display: 'segmented', value: 'smooth', group: 'trend', required: true,
      options: [opt('smooth', 'Smooth'), opt('linear', 'Straight'), opt('step', 'Steps')],
    },
    lineColor: colorField('Line colour', 'trend', 'var(--primary)'),
    lineWidth: { label: 'Line width (px)', type: 'number', min: 0.5, max: 8, step: 0.5, value: 2, group: 'trend' },
    fill: {
      label: 'Fill under the line', type: 'select', display: 'segmented', value: 'gradient', group: 'trend', required: true,
      options: [opt('none', 'None'), opt('opacity', 'Flat'), opt('gradient', 'Fading')],
    },
    fillOpacity: {
      label: 'Fill strength (%)', type: 'number', min: 0, max: 100, step: 5, value: 20, group: 'trend', advanced: true,
      showIf: { fill: ['opacity', 'gradient'] },
    },
    showLast: { label: 'Dot on the latest point', type: 'boolean', value: true, group: 'trend' },
    showMinMax: { label: 'Mark the lowest and highest points', type: 'boolean', value: false, group: 'trend' },
    ...rangesFields('The first range the latest value falls in colours it. Leave an end empty for open-ended.'),
    rangeTarget: {
      label: 'Range colour applies to', type: 'select', display: 'segmented', value: 'value', group: 'colour', required: true,
      options: [opt('value', 'Number'), opt('line', 'Line'), opt('both', 'Number and line')],
    },
    showChange: {
      label: 'Change since the first point', type: 'select', display: 'segmented', value: 'percent', group: 'change', required: true,
      options: [opt('off', 'Off'), opt('percent', '+12 %'), opt('delta', '+34')],
    },
    increaseIs: {
      label: 'An increase is', type: 'select', display: 'segmented', value: 'neutral', group: 'change', required: true,
      showIf: { showChange: ['percent', 'delta'] },
      options: [opt('good', 'Good'), opt('bad', 'Bad'), opt('neutral', 'Neutral')],
    },
    showArrow: { label: 'Arrow', type: 'boolean', value: true, group: 'change', advanced: true, showIf: { showChange: ['percent', 'delta'] } },
    upColor: colorField('Colour when good', 'change', 'var(--success)', { advanced: true }),
    downColor: colorField('Colour when bad', 'change', 'var(--error)', { advanced: true }),
    timeRange: {
      label: 'Time span text', type: 'select', display: 'segmented', value: 'auto', group: 'change', required: true,
      options: [opt('auto', 'over 12 h'), opt('custom', 'My text'), opt('off', 'Off')],
    },
    timeRangeText: { label: 'Text', type: 'text', maxLength: 40, placeholder: 'since Monday', group: 'change', showIf: { timeRange: 'custom' } },
    compareLabel: {
      label: 'Comparison label', type: 'text', maxLength: 40, placeholder: 'vs previous period', group: 'change', advanced: true,
      description: 'Shown instead of the time span when a "Compare with" value is bound.',
    },
    showUpdated: { label: 'Show "Updated … ago"', type: 'boolean', value: false, group: 'change', advanced: true },
  }),
  migrations: [],
};

export const STAT_SPARKLINE_KIND: BuiltinKindSpec = {
  type: 'stat.sparkline',
  label: 'Stat with trend',
  category: 'Data',
  description: 'The latest value of a bound series with its change and trend line.',
  icon: 'fas fa-arrow-trend-up',
  defaultW: 3,
  defaultH: 3,
  slots: [
    { key: 'series', label: 'Series', shape: 'series', required: true },
    { key: 'compare', label: 'Compare with', shape: 'scalar', required: false },
  ],
  template: STAT_SPARKLINE,
};
