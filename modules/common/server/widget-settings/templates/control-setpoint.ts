// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/control-setpoint.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, disableWhenField, fontField, layoutField, minBelowMax, opt, since, valueStyleFields } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { positiveStep } from '../views/content-logic';
import { feedbackFields } from '../views/control-common';

/** `control.setpoint`: type a number and apply it, or step it up and down (optionally around a dial). */
export const CONTROL_SETPOINT: SettingsTemplate = {
  id: 'builtin:control.setpoint',
  version: 1,
  namespace: '',
  label: 'Set point',
  format: true,
  exportable: false,
  cardDefaults: { buttons: [] },
  formatDefaults: { decimals: 0 },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'range', label: 'Range', tab: 'Display', since: 1 },
    { id: 'value', label: 'Values', tab: 'Display', since: 1 },
    { id: 'appearance', label: 'Buttons and box', tab: 'Display', since: 1 },
    { id: 'safety', label: 'Safety', tab: 'Display', since: 1 },
    { id: 'feedback', label: 'Feedback texts', tab: 'Behaviour', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('input', 'Type and apply', 'setpoint-input'),
      opt('stepper', 'Minus and plus buttons', 'setpoint-stepper'),
      opt('dial', 'Dial with minus and plus', 'setpoint-dial'),
    ]),
    label: { label: 'Label', type: 'text', maxLength: 40, group: 'label', placeholder: 'Target',
      description: 'What is being set. Empty = none (the card title often says it).' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    min: { label: 'Minimum', type: 'number', display: 'input', value: 0, group: 'range' },
    max: { label: 'Maximum', type: 'number', display: 'input', value: 100, group: 'range' },
    step: { label: 'Step', type: 'number', display: 'input', min: 0, value: 1, group: 'range' },
    showRange: { label: 'Show minimum and maximum', type: 'boolean', value: false, group: 'range', advanced: true,
      showIf: { layout: ['input', 'stepper'] } },
    showValue: { label: 'Show the current value', type: 'boolean', value: true, group: 'value',
      description: 'The value the device reports, top right; the control shows the one being set.' },
    currentLabel: { label: 'Current value caption', type: 'text', maxLength: 24, placeholder: 'Now', group: 'value', advanced: true,
      showIf: { showValue: true } },
    currentFont: fontField('Current value font', 'value', { advanced: true, showIf: { showValue: true } }),
    currentColor: colorField('Current value colour', 'value', 'var(--text-primary)', { advanced: true, showIf: { showValue: true } }),
    ...valueStyleFields('value'),
    unitDisplay: {
      label: 'Unit', type: 'select', display: 'segmented', value: 'show', group: 'value', required: true, advanced: true,
      options: [opt('show', 'With the numbers'), opt('hide', 'Hidden')],
      description: 'The unit comes from the value format.',
    },
    applyLabel: { label: 'Apply button text', type: 'text', maxLength: 24, placeholder: 'Apply', group: 'appearance',
      showIf: { layout: 'input' } },
    buttonColor: colorField('Button colour', 'appearance', 'var(--primary)'),
    buttonTextColor: colorField('Button text colour', 'appearance', undefined, { advanced: true, description: 'Empty = from the theme.' }),
    borderColor: colorField('Box border colour', 'appearance', 'var(--border)', { advanced: true, showIf: { layout: ['input', 'stepper'] } }),
    dialColor: colorField('Dial colour', 'appearance', undefined, { showIf: { layout: 'dial' }, description: 'Empty = the button colour.' }),
    dialTrackColor: colorField('Dial track colour', 'appearance', 'var(--surface-sunken)', { advanced: true, showIf: { layout: 'dial' } }),
    disableWhen: disableWhenField(),
    ...feedbackFields('feedback'),
  }),
  rules: [minBelowMax('min', 'max'), positiveStep('step')],
  migrations: [],
};

export const CONTROL_SETPOINT_KIND: BuiltinKindSpec = {
  type: 'control.setpoint',
  label: 'Set point',
  category: 'Device Controls',
  description: 'A number input with Apply, a stepper or a dial; out-of-range entries are a field error and send nothing.',
  icon: 'fas fa-gauge-simple',
  defaultW: 3,
  defaultH: 2,
  slots: [{ key: 'value', label: 'Current value', shape: 'scalar', required: false }],
  template: CONTROL_SETPOINT,
};
