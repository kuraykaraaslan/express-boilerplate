// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/stat-value.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, iconFields, layoutField, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `stat.value`: one number, a label, an icon, colour ranges and an optional comparison. */
export const STAT_VALUE: SettingsTemplate = {
  id: 'builtin:stat.value',
  version: 1,
  namespace: '',
  label: 'Stat',
  format: true,
  exportable: false,
  formatDefaults: { decimals: 0 },
  directionField: 'increaseIs',
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'value', label: 'Value', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'icon', label: 'Icon', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Colour ranges', tab: 'Display', since: 1 },
    { id: 'comparison', label: 'Comparison', tab: 'Display', since: 1, showWhen: { slotBound: 'compare' } },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('stacked', 'Stacked', 'stat-stacked'),
      opt('inline', 'Icon left', 'stat-inline'),
      opt('centered', 'Centred', 'stat-centered'),
      opt('compact', 'One line', 'stat-compact'),
    ]),
    autoScale: { label: 'Scale the number to the card', type: 'boolean', value: true, group: 'layout' },
    valueFont: fontField('Value font', 'value', { showIf: { autoScale: false } }),
    valueColor: colorField('Value colour', 'value', 'var(--text-primary)'),
    label: { label: 'Label', type: 'text', maxLength: 80, placeholder: 'Under the number', group: 'label' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    ...iconFields('icon', 'var(--primary)', 28),
    iconBackground: colorField('Icon background', 'icon', undefined, { advanced: true }),
    ...rangesFields('The first range the value falls in colours it. Leave an end empty for open-ended.'),
    rangeTarget: {
      label: 'Range colour applies to', type: 'select', display: 'segmented', value: 'value', group: 'colour', advanced: true, required: true,
      options: [opt('value', 'Number'), opt('icon', 'Icon'), opt('background', 'Card background')],
    },
    compareAs: {
      label: 'Show the change as', type: 'select', display: 'segmented', value: 'percent', group: 'comparison', required: true,
      options: [opt('percent', '+12 %'), opt('delta', '+34'), opt('value', 'Other value')],
    },
    increaseIs: {
      label: 'An increase is', type: 'select', display: 'segmented', value: 'neutral', group: 'comparison', required: true,
      options: [opt('good', 'Good'), opt('bad', 'Bad'), opt('neutral', 'Neutral')],
    },
    showArrow: { label: 'Arrow', type: 'boolean', value: true, group: 'comparison', advanced: true },
    showUpdated: { label: 'Show "Updated … ago"', type: 'boolean', value: false, group: 'label', advanced: true },
    compareLabel: { label: 'Comparison label', type: 'text', maxLength: 40, placeholder: 'vs previous period', group: 'comparison', advanced: true },
    upColor: colorField('Colour when good', 'comparison', 'var(--success)', { advanced: true }),
    downColor: colorField('Colour when bad', 'comparison', 'var(--error)', { advanced: true }),
  }),
  migrations: [],
};

export const STAT_VALUE_KIND: BuiltinKindSpec = {
  type: 'stat.value',
  label: 'Stat',
  category: 'Data',
  description: 'One bound number with a label, an icon, colour ranges and an optional comparison.',
  icon: 'fas fa-hashtag',
  defaultW: 3,
  defaultH: 3,
  slots: [
    { key: 'value', label: 'Value', shape: 'scalar', required: true },
    { key: 'compare', label: 'Compare with', shape: 'scalar', required: false },
  ],
  template: STAT_VALUE,
};
