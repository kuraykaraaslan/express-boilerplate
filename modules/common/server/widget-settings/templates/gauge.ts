// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/gauge.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, iconFields, layoutField, minBelowMax, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

const ranges = rangesFields('The value takes the colour of the range it falls in. Leave empty for a single colour.');

/** `gauge`: one bound number on an arc, a donut, a bar or a level, with colour ranges. */
export const GAUGE: SettingsTemplate = {
  id: 'builtin:gauge',
  version: 1,
  namespace: '',
  label: 'Gauge',
  format: true,
  exportable: false,
  formatDefaults: { decimals: 0 },
  cardDefaults: { staleDisplay: 'dim' },
  // The value's declared range (its source's `min` / `max`) is the default scale; 0 to 100 without one.
  scaleFields: { min: 'min', max: 'max' },
  rules: [
    minBelowMax('min', 'max'),
    (v) => typeof v.startAngle === 'number' && typeof v.endAngle === 'number' && v.startAngle >= v.endAngle
      ? [{ path: 'endAngle', message: 'End angle must be greater than start angle' }]
      : [],
  ],
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'icon', label: 'Icon', tab: 'Display', since: 1 },
    { id: 'scale', label: 'Scale', tab: 'Display', since: 1 },
    { id: 'value', label: 'Value', tab: 'Display', since: 1 },
    { id: 'needle', label: 'Needle', tab: 'Display', since: 1 },
    { id: 'bar', label: 'Bar and track', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Colour ranges', tab: 'Display', since: 1 },
    { id: 'motion', label: 'Animation', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('arc', 'Half circle', 'gauge-arc'),
      opt('donut', 'Donut', 'gauge-donut'),
      opt('bar-horizontal', 'Horizontal bar', 'gauge-bar-h'),
      opt('bar-vertical', 'Vertical bar', 'gauge-bar-v'),
      opt('level', 'Level (thermometer)', 'gauge-level'),
    ]),
    startAngle: {
      label: 'Start angle (°)', type: 'number', display: 'input', min: -360, max: 360, value: -135, group: 'layout', advanced: true,
      showIf: { layout: 'donut' }, description: 'Clockwise from 12 o\'clock.',
    },
    endAngle: {
      label: 'End angle (°)', type: 'number', display: 'input', min: -360, max: 360, value: 135, group: 'layout', advanced: true,
      showIf: { layout: 'donut' },
    },
    label: { label: 'Label', type: 'text', maxLength: 80, placeholder: 'Above the gauge', group: 'label' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    ...iconFields('icon', 'var(--primary)', 20),
    iconBackground: colorField('Icon background', 'icon', undefined, { advanced: true }),
    min: {
      label: 'Minimum', type: 'number', display: 'input', value: 0, group: 'scale',
      description: 'Used when no value is chosen for Minimum on the Data tab. Until set, the value\'s own minimum when its source declares one.',
    },
    max: {
      label: 'Maximum', type: 'number', display: 'input', value: 100, group: 'scale',
      description: 'Used when no value is chosen for Maximum on the Data tab. Until set, the value\'s own maximum when its source declares one.',
    },
    showMinMax: { label: 'Show min and max', type: 'boolean', value: true, group: 'scale' },
    minMaxFont: fontField('Scale font', 'scale', { advanced: true }),
    minMaxColor: colorField('Scale colour', 'scale', 'var(--text-secondary)', { advanced: true }),
    ticks: { label: 'Tick marks', type: 'number', min: 0, max: 21, value: 0, group: 'scale', description: '0 = none; ends included.' },
    tickLabels: { label: 'Values at the ticks', type: 'boolean', value: false, group: 'scale', advanced: true },
    tickColor: colorField('Tick colour', 'scale', 'var(--border-strong)', { advanced: true }),
    showValue: { label: 'Show the number', type: 'boolean', value: true, group: 'value' },
    valueFont: fontField('Value font', 'value', { advanced: true, description: 'Empty = sized to the gauge.' }),
    valueColor: colorField('Value colour', 'value', 'var(--text-primary)'),
    unitTitle: { label: 'Units title', type: 'text', maxLength: 40, placeholder: 'Temperature', group: 'value', description: 'A caption under the number.' },
    needle: { label: 'Needle', type: 'boolean', value: false, group: 'needle' },
    needleStyle: {
      label: 'Needle style', type: 'select', display: 'segmented', value: 'line', group: 'needle', required: true, showIf: { needle: true },
      options: [opt('line', 'Line'), opt('arrow', 'Pointer'), opt('marker', 'Notch')],
    },
    needleColor: colorField('Needle colour', 'needle', 'var(--text-primary)', { advanced: true, showIf: { needle: true } }),
    barColorMode: {
      label: 'Bar colour', type: 'select', display: 'segmented', value: 'range', group: 'bar', required: true,
      options: [opt('range', 'From the colour ranges'), opt('constant', 'Always the same')],
    },
    barColor: colorField('Bar colour', 'bar', 'var(--primary)', { description: 'Used when no colour range matches, or always.' }),
    trackColor: colorField('Track colour', 'bar', 'var(--border)', { advanced: true }),
    thickness: { label: 'Thickness', type: 'number', min: 2, max: 40, value: 14, group: 'bar' },
    roundedCaps: { label: 'Rounded ends', type: 'boolean', value: true, group: 'bar', advanced: true },
    ranges: ranges.ranges,
    // Today's gauge counts a value on a boundary in the band ending there.
    rangeEdges: { ...ranges.rangeEdges, value: 'to' },
    rangeDisplay: {
      label: 'Show the ranges on the scale', type: 'select', display: 'segmented', value: 'outer', group: 'colour', required: true,
      options: [opt('outer', 'Thin line beside the bar'), opt('track', 'Tinted track'), opt('off', 'Off')],
    },
    rangeOpacity: {
      label: 'Track tint (%)', type: 'number', min: 5, max: 100, step: 5, value: 35, group: 'colour', advanced: true,
      showIf: { rangeDisplay: 'track' },
    },
    animation: { label: 'Animate changes', type: 'boolean', value: true, group: 'motion', advanced: true },
  }),
  migrations: [],
};

export const GAUGE_KIND: BuiltinKindSpec = {
  type: 'gauge',
  label: 'Gauge',
  category: 'Gauges & Levels',
  description: 'One bound number on an arc, a donut, a bar or a level, with colour ranges.',
  icon: 'fas fa-gauge-high',
  defaultW: 3,
  defaultH: 3,
  slots: [
    { key: 'value', label: 'Value', shape: 'scalar', required: true },
    { key: 'min', label: 'Minimum', shape: 'scalar', required: false },
    { key: 'max', label: 'Maximum', shape: 'scalar', required: false },
  ],
  template: GAUGE,
};
