// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/control-slider.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, disableWhenField, fontField, layoutField, minBelowMax, opt, since, valueStyleFields } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { positiveStep } from '../views/content-logic';
import { feedbackFields } from '../views/control-common';

/** `control.slider`: a bound number, written once per gesture (or debounced). */
export const CONTROL_SLIDER: SettingsTemplate = {
  id: 'builtin:control.slider',
  version: 1,
  namespace: '',
  label: 'Slider',
  format: true,
  exportable: false,
  cardDefaults: { buttons: [] },
  formatDefaults: { decimals: 0 },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'range', label: 'Range', tab: 'Display', since: 1 },
    { id: 'value', label: 'Value', tab: 'Display', since: 1 },
    { id: 'ticks', label: 'Scale', tab: 'Display', since: 1 },
    { id: 'colours', label: 'Track', tab: 'Display', since: 1 },
    { id: 'icons', label: 'Icons', tab: 'Display', since: 1 },
    { id: 'commit', label: 'Sending', tab: 'Display', since: 1 },
    { id: 'safety', label: 'Safety', tab: 'Display', since: 1 },
    { id: 'feedback', label: 'Feedback texts', tab: 'Behaviour', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('default', 'Label and value above', 'slider-default'),
      opt('extended', 'Large value, centred', 'slider-extended'),
      opt('compact', 'One line', 'slider-compact'),
    ]),
    orientation: {
      label: 'Direction', type: 'select', display: 'segmented', value: 'horizontal', group: 'layout', required: true,
      options: [opt('horizontal', 'Horizontal'), opt('vertical', 'Vertical')],
      description: 'Vertical puts the minimum at the bottom; give the card some height.',
    },
    label: { label: 'Label', type: 'text', maxLength: 40, group: 'label', placeholder: 'Speed',
      description: 'What the slider sets. Empty = none (the card title often says it).' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    min: { label: 'Minimum', type: 'number', display: 'input', value: 0, group: 'range' },
    max: { label: 'Maximum', type: 'number', display: 'input', value: 100, group: 'range' },
    step: { label: 'Step', type: 'number', display: 'input', min: 0, value: 1, group: 'range' },
    showValue: { label: 'Show the value', type: 'boolean', value: true, group: 'value' },
    valuePosition: {
      label: 'Value position', type: 'select', display: 'segmented', value: 'top', group: 'value', required: true,
      showIf: { layout: 'default', orientation: 'horizontal', showValue: true },
      options: [opt('top', 'Top right'), opt('end', 'After the track'), opt('bottom', 'Under the track')],
    },
    ...valueStyleFields('value'),
    showMinMax: { label: 'Show minimum and maximum', type: 'boolean', value: true, group: 'ticks' },
    tickMarks: { label: 'Tick marks', type: 'number', nullable: true, display: 'input', min: 2, max: 21, group: 'ticks',
      placeholder: 'None', description: 'How many evenly spaced marks to draw along the track.' },
    tickLabels: { label: 'Print the value at each mark', type: 'boolean', value: false, group: 'ticks', advanced: true },
    mainColor: colorField('Main colour', 'colours', 'var(--primary)', { description: 'The filled part of the track and the thumb.' }),
    trackColor: colorField('Track colour', 'colours', 'var(--surface-sunken)', { advanced: true }),
    disabledMainColor: colorField('Main colour when disabled', 'colours', 'var(--text-disabled)', { advanced: true }),
    disabledTrackColor: colorField('Track colour when disabled', 'colours', 'var(--surface-sunken)', { advanced: true }),
    thickness: { label: 'Track thickness (px)', type: 'number', min: 2, max: 16, value: 6, group: 'colours', advanced: true },
    thumbSize: { label: 'Thumb size (px)', type: 'number', min: 8, max: 32, value: 18, group: 'colours', advanced: true },
    startIcon: { label: 'Start icon', type: 'icon', placeholder: 'fas fa-volume-low', group: 'icons',
      description: 'Before the track (under it when vertical).' },
    endIcon: { label: 'End icon', type: 'icon', placeholder: 'fas fa-volume-high', group: 'icons' },
    iconColor: colorField('Icon colour', 'icons', 'var(--text-secondary)', { advanced: true }),
    iconSize: { label: 'Icon size (px)', type: 'number', min: 8, max: 48, value: 16, group: 'icons', advanced: true },
    commit: {
      label: 'Send the value', type: 'select', display: 'segmented', value: 'release', group: 'commit', required: true, advanced: true,
      options: [opt('release', 'When released'), opt('debounced', 'While dragging, after a pause')],
    },
    debounceMs: { label: 'Pause before sending (ms)', type: 'number', display: 'input', min: 100, max: 5000, value: 500,
      group: 'commit', advanced: true, showIf: { commit: 'debounced' } },
    disableWhen: disableWhenField(),
    ...feedbackFields('feedback'),
  }),
  rules: [minBelowMax('min', 'max'), positiveStep('step')],
  migrations: [],
};

export const CONTROL_SLIDER_KIND: BuiltinKindSpec = {
  type: 'control.slider',
  label: 'Slider',
  category: 'Device Controls',
  description: 'A slider reading a bound number and writing once, on release.',
  icon: 'fas fa-sliders',
  defaultW: 4,
  defaultH: 3,
  slots: [{ key: 'value', label: 'Current value', shape: 'scalar', required: false }],
  template: CONTROL_SLIDER,
};
