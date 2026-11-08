// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/control-form.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, disableWhenField, fontField, opt, since } from '../settings/packs';
import type { SettingsTemplate, Sparse } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { feedbackFields } from '../views/control-common';
import { isFormKey, parseOptions, type FormFieldSetting } from '../views/control-form-logic';

const rows = (v: Sparse): FormFieldSetting[] => (Array.isArray(v.fields) ? (v.fields as FormFieldSetting[]).filter((r) => r && typeof r === 'object') : []);

/**
 * `control.form`: several fields edited together and saved as one command. A field left empty, or switched off by its
 * gate, is not sent at all (v2; v1 sent `null`, which a command's schema refused for an optional parameter).
 */
export const CONTROL_FORM: SettingsTemplate = {
  id: 'builtin:control.form',
  version: 2,
  namespace: '',
  label: 'Form',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [] },
  groups: [
    { id: 'label', label: 'Label', tab: 'Display', since: 1 },
    { id: 'fields', label: 'Fields', tab: 'Display', since: 1 },
    { id: 'buttons', label: 'Buttons', tab: 'Display', since: 1 },
    { id: 'safety', label: 'Safety', tab: 'Display', since: 1 },
    { id: 'feedback', label: 'Feedback texts', tab: 'Behaviour', since: 1 },
  ],
  fields: {
    ...since(1, {
    label: { label: 'Label', type: 'text', maxLength: 60, group: 'label', placeholder: 'Pump settings', description: 'Empty = none (the card title often says it).' },
    labelFont: fontField('Label font', 'label', { advanced: true }),
    labelColor: colorField('Label colour', 'label', 'var(--text-secondary)', { advanced: true }),
    fields: {
      label: 'Fields', type: 'repeater', group: 'fields', max: 40,
      description: 'Each key is a name the command reads from the saved values (`{"$field":"key"}` in the command\'s parameters). A field takes its word, unit and step from the source when left empty. A field the viewer leaves empty, or that its gate switches off, is not sent at all: the command sees `{"$field":"key"}` as absent.',
      fields: {
        key: { label: 'Key', type: 'text', maxLength: 64, required: true, placeholder: 'lowThreshold' },
        label: { label: 'Label', type: 'text', maxLength: 60, placeholder: 'From the source, else the key' },
        type: {
          label: 'Kind', type: 'select', value: 'number', required: true,
          options: [opt('number', 'Number'), opt('boolean', 'On / off'), opt('text', 'Text'), opt('enum', 'One of a list')],
        },
        min: { label: 'Minimum', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
        max: { label: 'Maximum', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
        step: { label: 'Step', type: 'number', nullable: true, display: 'input', min: 0, placeholder: 'any' },
        options: { label: 'List', type: 'text', maxLength: 400, placeholder: 'low, medium, high  or  1=Low, 2=High' },
        unit: { label: 'Unit', type: 'text', maxLength: 16 },
        gate: { label: 'Only when on', type: 'text', maxLength: 64, placeholder: 'Key of an on / off field', description: 'The field is editable only while that on / off field is on; off, it is not sent.' },
        required: { label: 'Required', type: 'boolean', value: false },
        readOnly: { label: 'Show only', type: 'boolean', value: false },
        placeholder: { label: 'Hint', type: 'text', maxLength: 60 },
        group: { label: 'Section', type: 'text', maxLength: 40, placeholder: 'Thresholds' },
      },
    },
    fromSource: {
      label: 'Take the fields from the source', type: 'boolean', value: true, group: 'fields',
      description: 'With no fields above, the form edits every field the bound record describes, in the source\'s order.',
    },
    saveLabel: { label: 'Save button text', type: 'text', maxLength: 24, placeholder: 'Save', group: 'buttons' },
    showReset: { label: 'Show a reset button', type: 'boolean', value: true, group: 'buttons' },
    resetLabel: { label: 'Reset button text', type: 'text', maxLength: 24, placeholder: 'Reset', group: 'buttons', showIf: { showReset: true } },
    disableWhen: disableWhenField(),
    ...feedbackFields('feedback'),
    }),
    // Version 2: a save may send only what changed (and leaves empty fields out, which needs no field).
    ...since(2, {
    saveChangedOnly: {
      label: 'Send only the fields that changed', type: 'boolean', value: false, group: 'buttons',
      description: 'Off: every field with a value is sent, so one save sets them all. On: only what the viewer edited, so a command that reads its other fields sees them as absent.',
    },
    }),
  },
  rules: [
    (v) => {
      const list = rows(v);
      const issues: Array<{ path: string; message: string }> = [];
      const keys = new Set<string>();
      list.forEach((r, i) => {
        if (!isFormKey(r.key)) issues.push({ path: `fields.${i}.key`, message: 'A key starts with a letter or _ and has only letters, digits, . _ -' });
        else if (keys.has(r.key)) issues.push({ path: `fields.${i}.key`, message: 'Keys must be different' });
        else keys.add(r.key);
        if (r.type === 'enum' && parseOptions(r.options).length === 0) issues.push({ path: `fields.${i}.options`, message: 'A list field needs at least one value' });
        if (typeof r.min === 'number' && typeof r.max === 'number' && r.min >= r.max) issues.push({ path: `fields.${i}.max`, message: 'Maximum must be greater than minimum' });
        if (typeof r.gate === 'string' && r.gate && r.gate === r.key) issues.push({ path: `fields.${i}.gate`, message: 'A field cannot switch itself on' });
      });
      return issues;
    },
  ],
  migrations: [
    { from: 1, to: 2, note: 'An empty field and a switched-off gated field are left out of a save instead of sent as empty; "Send only the fields that changed" is new (off).' },
  ],
};

export const CONTROL_FORM_KIND: BuiltinKindSpec = {
  type: 'control.form',
  label: 'Form',
  category: 'Device Controls',
  description: 'Several fields edited together and saved as one command: numbers, switches, text and lists.',
  icon: 'fas fa-pen-to-square',
  defaultW: 4,
  defaultH: 4,
  slots: [{ key: 'record', label: 'Current values', shape: 'record', required: false }],
  template: CONTROL_FORM,
};
