// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/state.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, layoutField, opt, since, valueStyleFields } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `state`: a bound value mapped to a labelled, coloured state. */
export const STATE: SettingsTemplate = {
  id: 'builtin:state',
  version: 1,
  namespace: '',
  label: 'State',
  format: false,
  exportable: false,
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'states', label: 'States', tab: 'Display', since: 1 },
    { id: 'fallback', label: 'Otherwise', tab: 'Display', since: 1 },
    { id: 'text', label: 'State text', tab: 'Display', since: 1 },
    { id: 'value', label: 'Under the state', tab: 'Display', since: 1 },
    { id: 'stale', label: 'Old data', tab: 'Data', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('big', 'Big text', 'state-big'),
      opt('badge', 'Badge', 'state-badge'),
      opt('dot', 'Dot and label', 'state-dot'),
      opt('tile', 'Tinted card', 'state-tile'),
      opt('icon', 'Big icon', 'state-icon'),
      opt('lamp', 'Lamp', 'state-lamp'),
    ]),
    alignment: {
      label: 'Alignment', type: 'select', display: 'segmented', value: 'start', group: 'layout', required: true,
      options: [opt('start', 'Like a stat'), opt('center', 'Centred')],
    },
    lampSize: { label: 'Lamp size (px)', type: 'number', min: 16, max: 200, value: 56, group: 'layout', showIf: { layout: 'lamp' } },
    lampLabel: { label: 'Show the state word under the lamp', type: 'boolean', value: true, group: 'layout', showIf: { layout: 'lamp' } },
    lampDim: colorField('Dim colour', 'layout', 'var(--border)', { showIf: { layout: 'lamp' }, description: 'Drawn for an unknown state and for a state that is not lit.' }),
    iconSize: { label: 'Icon size (px)', type: 'number', min: 8, max: 80, value: 18, group: 'layout', advanced: true },
    label: { label: 'Label', type: 'text', maxLength: 80, placeholder: 'Above the state', group: 'label' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    states: {
      label: 'States', type: 'repeater', group: 'states', max: 30,
      description: 'First matching rule wins. Match an exact value, or give a range with "at least" / "at most".',
      fields: {
        match: { label: 'Equals', type: 'text', maxLength: 120 },
        gte: { label: 'At least', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
        lte: { label: 'At most', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
        label: { label: 'Label', type: 'text', maxLength: 60, placeholder: 'The value' },
        color: { label: 'Colour', type: 'color', value: 'var(--success)' },
        background: { label: 'Background', type: 'color', placeholder: 'A tint of the colour' },
        icon: { label: 'Icon', type: 'icon', placeholder: 'fas fa-check' },
        pulse: { label: 'Pulse (for alarms)', type: 'boolean', value: false },
        lit: { label: 'Lit (lamp layout)', type: 'boolean', value: true },
      },
    },
    fallbackLabel: { label: 'Label', type: 'text', maxLength: 60, placeholder: 'The raw value', group: 'fallback' },
    fallbackColor: colorField('Colour', 'fallback', 'var(--text-secondary)'),
    fallbackBackground: colorField('Background', 'fallback', undefined, { advanced: true }),
    fallbackIcon: { label: 'Icon', type: 'icon', group: 'fallback', advanced: true },
    stateFont: fontField('State font', 'text', { description: 'Empty = sized to the card.' }),
    showSince: { label: 'How long it has been in this state', type: 'boolean', value: true, group: 'value' },
    showValue: { label: 'The raw value', type: 'boolean', value: false, group: 'value' },
    ...valueStyleFields('value', 'var(--text-secondary)'),
    staleAsUnknown: {
      label: 'Show "unknown" when the data is old', type: 'boolean', value: true, group: 'stale',
      description: 'Showing "OK" for a reading nobody has heard from in an hour is worse than showing nothing.',
    },
    unknownLabel: { label: 'Unknown label', type: 'text', maxLength: 40, value: 'Unknown', group: 'stale', advanced: true },
  }),
  migrations: [],
};

export const STATE_KIND: BuiltinKindSpec = {
  type: 'state',
  label: 'State',
  category: 'Data',
  description: 'A bound value mapped to a labelled, coloured state.',
  icon: 'fas fa-circle-dot',
  defaultW: 3,
  defaultH: 3,
  slots: [{ key: 'value', label: 'Value', shape: 'scalar', required: true }],
  template: STATE,
};
