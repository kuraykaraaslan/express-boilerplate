// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/progress.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, iconFields, layoutField, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `progress`: a bound number against a target, as a bar, a ring or a half ring. */
export const PROGRESS: SettingsTemplate = {
  id: 'builtin:progress',
  version: 1,
  namespace: '',
  label: 'Progress',
  format: true,
  exportable: false,
  formatDefaults: { decimals: 0 },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'target', label: 'Target', tab: 'Data', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'icon', label: 'Icon', tab: 'Display', since: 1 },
    { id: 'value', label: 'Value text', tab: 'Display', since: 1 },
    { id: 'bar', label: 'Bar', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Colour ranges', tab: 'Display', since: 1 },
    { id: 'ticks', label: 'Scale and marker', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('bar-labelled', 'Number and bar', 'progress-bar-labelled'),
      opt('bar', 'Bar with the number beside', 'progress-bar'),
      opt('ring', 'Ring', 'progress-ring'),
      opt('semicircle', 'Half ring', 'progress-semicircle'),
    ]),
    target: {
      label: 'Target', type: 'number', display: 'input', min: 0, value: 100, group: 'target',
      description: 'Used when no value is chosen for Target on the Data tab.',
    },
    label: { label: 'Label', type: 'text', maxLength: 80, placeholder: 'Above the number', group: 'label' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    ...iconFields('icon', 'var(--primary)', 20),
    iconBackground: colorField('Icon background', 'icon', undefined, { advanced: true }),
    valueText: {
      label: 'Show', type: 'select', display: 'segmented', value: 'value', group: 'value', required: true,
      options: [opt('value', '42 of 100'), opt('percent', '42 %'), opt('both', '42 of 100 · 42 %'), opt('none', 'Nothing')],
    },
    textPosition: {
      label: 'Number', type: 'select', display: 'segmented', value: 'above', group: 'value', required: true,
      showIf: { layout: 'bar-labelled' }, options: [opt('above', 'Above the bar'), opt('below', 'Below the bar')],
    },
    autoScale: { label: 'Scale the number to the card', type: 'boolean', value: true, group: 'value' },
    valueFont: fontField('Value font', 'value', { showIf: { autoScale: false } }),
    valueColor: colorField('Value colour', 'value', 'var(--text-primary)'),
    barColor: colorField('Bar colour', 'bar', 'var(--primary)'),
    barGradient: { label: 'Gradient', type: 'boolean', value: false, group: 'bar' },
    gradientStart: colorField('Gradient starts with', 'bar', 'var(--info)', { showIf: { barGradient: true } }),
    trackColor: colorField('Track colour', 'bar', 'var(--border)', { advanced: true }),
    thickness: { label: 'Thickness (px)', type: 'number', min: 2, max: 48, value: 8, group: 'bar' },
    roundedEnds: { label: 'Rounded ends', type: 'boolean', value: true, group: 'bar', advanced: true },
    ...rangesFields('The first range the value (not the percentage) falls in colours the bar.'),
    rangeDisplay: {
      label: 'Ranges show as', type: 'select', display: 'segmented', value: 'bar', group: 'colour', required: true,
      options: [opt('bar', 'Bar colour'), opt('track', 'Zones on the track'), opt('both', 'Both')],
    },
    showTicks: { label: 'Scale under the bar', type: 'boolean', value: false, group: 'ticks', showIf: { layout: ['bar', 'bar-labelled'] } },
    tickCount: { label: 'Steps between 0 and the target', type: 'number', min: 0, max: 11, value: 0, group: 'ticks', advanced: true, showIf: { showTicks: true } },
    ticksFont: fontField('Scale font', 'ticks', { advanced: true, showIf: { showTicks: true } }),
    ticksColor: colorField('Scale colour', 'ticks', 'var(--text-secondary)', { advanced: true, showIf: { showTicks: true } }),
    marker: {
      label: 'Marker at', type: 'number', nullable: true, display: 'input', placeholder: 'none', group: 'ticks',
      description: 'A line across the bar at this value, e.g. where you should be by today.',
    },
    markerLabel: { label: 'Marker label', type: 'text', maxLength: 40, placeholder: 'Expected', group: 'ticks', advanced: true },
    markerColor: colorField('Marker colour', 'ticks', 'var(--text-primary)', { advanced: true }),
  }),
  migrations: [],
};

export const PROGRESS_KIND: BuiltinKindSpec = {
  type: 'progress',
  label: 'Progress',
  category: 'Data',
  description: 'A bound number against a target, as a bar, a ring or a half ring.',
  icon: 'fas fa-bars-progress',
  defaultW: 3,
  defaultH: 2,
  slots: [
    { key: 'value', label: 'Value', shape: 'scalar', required: true },
    { key: 'target', label: 'Target', shape: 'scalar', required: false },
  ],
  template: PROGRESS,
};
