// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/control-button.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, layoutField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { feedbackFields } from '../views/control-common';

/** `control.button`: one press runs the placement's command (the command alone decides what is written). */
export const CONTROL_BUTTON: SettingsTemplate = {
  id: 'builtin:control.button',
  version: 1,
  namespace: '',
  label: 'Button',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [] },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'button', label: 'Button', tab: 'Display', since: 1 },
    { id: 'description', label: 'Description', tab: 'Display', since: 1 },
    { id: 'appearance', label: 'Appearance', tab: 'Display', since: 1 },
    { id: 'states', label: 'Hover and disabled', tab: 'Display', since: 1 },
    { id: 'feedback', label: 'Feedback texts', tab: 'Behaviour', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('button', 'Button', 'button-button'),
      opt('tile', 'Tile with icon', 'button-tile'),
      opt('icon', 'Round icon', 'button-icon'),
      opt('fab', 'Floating pill', 'button-fab'),
    ]),
    label: { label: 'Button text', type: 'text', maxLength: 40, placeholder: 'Run', group: 'button' },
    labelFont: fontField('Text font', 'button', { advanced: true }),
    icon: { label: 'Icon', type: 'icon', placeholder: 'fas fa-power-off', group: 'button' },
    iconSize: { label: 'Icon size (px)', type: 'number', min: 8, max: 96, value: 16, group: 'button', advanced: true },
    iconPosition: {
      label: 'Icon position', type: 'select', display: 'segmented', value: 'start', group: 'button', required: true, advanced: true,
      showIf: { layout: ['button', 'fab'] },
      options: [opt('start', 'Before the text'), opt('end', 'After the text')],
    },
    description: { label: 'Description', type: 'text', maxLength: 80, group: 'description', placeholder: 'Restarts conveyor 2',
      description: 'A short line above the button saying what it does. Empty = none.' },
    descriptionFont: fontField('Description font', 'description', { advanced: true }),
    descriptionColor: colorField('Description colour', 'description', 'var(--text-secondary)', { advanced: true }),
    appearance: {
      label: 'Style', type: 'select', display: 'segmented', value: 'filled', group: 'appearance', required: true,
      options: [opt('filled', 'Filled'), opt('outlined', 'Outlined'), opt('ghost', 'Plain'), opt('underlined', 'Underlined')],
    },
    mainColor: colorField('Main colour', 'appearance', 'var(--primary)', {
      description: 'Fill of a filled button; text and border of the others.',
    }),
    textColor: colorField('Text colour', 'appearance', undefined, { advanced: true, description: 'Empty = from the style.' }),
    backgroundColor: colorField('Background colour', 'appearance', undefined, { advanced: true, description: 'Empty = from the style.' }),
    borderRadius: { label: 'Corner radius (px)', type: 'number', nullable: true, display: 'input', min: 0, max: 64,
      placeholder: 'Theme', group: 'appearance', advanced: true },
    size: {
      label: 'Size', type: 'select', display: 'segmented', value: 'md', group: 'appearance', required: true,
      options: [opt('sm', 'S'), opt('md', 'M'), opt('lg', 'L')],
    },
    fullWidth: { label: 'Fill the card width', type: 'boolean', value: true, group: 'appearance', showIf: { layout: 'button' } },
    align: {
      label: 'Position', type: 'select', display: 'segmented', value: 'center', group: 'appearance', required: true, advanced: true,
      options: [opt('start', 'Left'), opt('center', 'Centre'), opt('end', 'Right')],
      description: 'Where a button narrower than the card sits.',
    },
    hoverColor: colorField('Colour on hover', 'states', undefined, {
      advanced: true, description: 'Fill of a filled button, background of the others. Empty = a shade of the main colour.',
    }),
    hoverTextColor: colorField('Text colour on hover', 'states', undefined, { advanced: true }),
    disabledColor: colorField('Colour when disabled', 'states', undefined, {
      advanced: true, description: 'Empty = the normal colours at half strength.',
    }),
    disabledTextColor: colorField('Text colour when disabled', 'states', undefined, { advanced: true }),
    ...feedbackFields('feedback'),
  }),
  migrations: [],
};

export const CONTROL_BUTTON_KIND: BuiltinKindSpec = {
  type: 'control.button',
  label: 'Button',
  category: 'Controls',
  description: 'A button that runs a command, with the command’s own confirmation policy.',
  icon: 'fas fa-circle-play',
  defaultW: 3,
  defaultH: 2,
  slots: [],
  template: CONTROL_BUTTON,
};
