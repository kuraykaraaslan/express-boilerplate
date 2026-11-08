// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/control-switch.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, disableWhenField, fontField, iconFields, layoutField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { feedbackFields } from '../views/control-common';

/** `control.switch`: reads a bound state, asks the host to write the toggled value. */
export const CONTROL_SWITCH: SettingsTemplate = {
  id: 'builtin:control.switch',
  version: 1,
  namespace: '',
  label: 'Switch',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [] },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'states', label: 'State text', tab: 'Display', since: 1 },
    { id: 'icons', label: 'Icon per state', tab: 'Display', since: 1 },
    { id: 'colours', label: 'Switch colours', tab: 'Display', since: 1 },
    { id: 'reading', label: 'Reading', tab: 'Data', since: 1 },
    { id: 'safety', label: 'Safety', tab: 'Display', since: 1 },
    { id: 'feedback', label: 'Feedback texts', tab: 'Behaviour', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('right', 'State left, switch right', 'switch-right'),
      opt('left', 'Switch left, state right', 'switch-left'),
      opt('centered', 'Centred, large', 'switch-centered'),
    ]),
    size: {
      label: 'Switch size', type: 'select', display: 'segmented', value: 'auto', group: 'layout', required: true,
      options: [opt('auto', 'Auto'), opt('sm', 'S'), opt('md', 'M'), opt('lg', 'L')],
      description: 'Auto = large when centred, medium otherwise.',
    },
    label: { label: 'Label', type: 'text', maxLength: 40, group: 'label',
      description: 'What the switch controls, above the state. Empty = none (the card title often says it).' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    ...iconFields('label', 'var(--primary)', 20),
    stateDisplay: {
      label: 'Show the state as', type: 'select', display: 'segmented', value: 'text', group: 'states', required: true,
      options: [opt('text', 'Large text'), opt('pill', 'Status pill'), opt('none', 'Nothing')],
      description: 'An unknown state is always shown.',
    },
    onLabel: { label: 'On text', type: 'text', maxLength: 24, placeholder: 'On', group: 'states' },
    offLabel: { label: 'Off text', type: 'text', maxLength: 24, placeholder: 'Off', group: 'states' },
    unknownLabel: { label: 'Unknown text', type: 'text', maxLength: 24, placeholder: 'Unknown', group: 'states', advanced: true },
    stateFont: fontField('State text font', 'states', { advanced: true, description: 'A size here replaces the automatic one.' }),
    onTextColor: colorField('On text colour', 'states', undefined, { advanced: true, description: 'Empty = the switch colour when on.' }),
    offTextColor: colorField('Off text colour', 'states', 'var(--text-secondary)', { advanced: true }),
    unknownTextColor: colorField('Unknown text colour', 'states', 'var(--warning)', { advanced: true }),
    onIcon: { label: 'Icon when on', type: 'icon', placeholder: 'fas fa-power-off', group: 'icons', advanced: true,
      description: 'Replaces the icon (and the pill’s dot) while on.' },
    offIcon: { label: 'Icon when off', type: 'icon', group: 'icons', advanced: true },
    unknownIcon: { label: 'Icon when unknown', type: 'icon', placeholder: 'fas fa-circle-exclamation', group: 'icons', advanced: true },
    onColor: colorField('Track when on', 'colours', 'var(--success)'),
    offColor: colorField('Track when off', 'colours', 'var(--border-strong)', { advanced: true }),
    disabledColor: colorField('Track when disabled', 'colours', 'var(--surface-sunken)', { advanced: true }),
    thumbColor: colorField('Knob when on', 'colours', 'var(--primary-fg)', { advanced: true }),
    thumbOffColor: colorField('Knob when off', 'colours', undefined, { advanced: true, description: 'Empty = as when on.' }),
    thumbDisabledColor: colorField('Knob when disabled', 'colours', undefined, { advanced: true, description: 'Empty = as when on.' }),
    onMatch: { label: 'Value that means on', type: 'text', maxLength: 40, placeholder: 'true, 1, on', group: 'reading', advanced: true,
      description: 'Empty = true, 1, "on", "yes" and "true" mean on. Otherwise only this exact value does.' },
    disableWhen: disableWhenField(),
    ...feedbackFields('feedback'),
  }),
  migrations: [],
};

export const CONTROL_SWITCH_KIND: BuiltinKindSpec = {
  type: 'control.switch',
  label: 'Switch',
  category: 'Device Controls',
  description: 'An on/off switch reading a bound boolean and writing on toggle.',
  icon: 'fas fa-toggle-on',
  defaultW: 3,
  defaultH: 2,
  slots: [{ key: 'value', label: 'Current state', shape: 'scalar', required: false }],
  template: CONTROL_SWITCH,
};
