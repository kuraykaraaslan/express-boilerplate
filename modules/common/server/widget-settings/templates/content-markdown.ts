// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/content-markdown.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, layoutField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `content.markdown`: author-written text (a safe markdown subset), optionally filled from a bound record. */
export const CONTENT_MARKDOWN: SettingsTemplate = {
  id: 'builtin:content.markdown',
  version: 1,
  namespace: '',
  label: 'Text',
  format: true,
  exportable: false,
  cardDefaults: { buttons: [] },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'content', label: 'Content', tab: 'Display', since: 1 },
    { id: 'callout', label: 'Callout', tab: 'Display', since: 1 },
    { id: 'text', label: 'Text style', tab: 'Display', since: 1 },
    { id: 'overflow', label: 'Long text', tab: 'Display', since: 1 },
    { id: 'record', label: 'Record values', tab: 'Data', since: 1, showWhen: { slotBound: 'record' } },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('plain', 'Plain text', 'markdown-plain'),
      opt('callout', 'Callout box', 'markdown-callout'),
    ]),
    content: {
      label: 'Text (Markdown)', type: 'textarea', maxLength: 20000, value: '', group: 'content',
      placeholder: '## Heading\n\nSome **bold** text, a [link](/admin) and a value: {{temperature}}.',
      description: 'Headings, lists, quotes, code, bold, italic and links. HTML is shown as text, never run. '
        + '{{field}} inserts a value of the bound record, {{param_name}} a board parameter (not inside `code`).',
    },
    calloutStyle: {
      label: 'Callout style', type: 'select', display: 'segmented', value: 'info', group: 'callout', required: true,
      showIf: { layout: 'callout' },
      options: [opt('info', 'Info'), opt('success', 'Success'), opt('warning', 'Warning'), opt('error', 'Error'), opt('custom', 'Custom')],
    },
    calloutColor: colorField('Callout accent colour', 'callout', 'var(--primary)', { showIf: { layout: 'callout', calloutStyle: 'custom' } }),
    calloutBackground: colorField('Callout background', 'callout', 'var(--primary-subtle)', { showIf: { layout: 'callout', calloutStyle: 'custom' } }),
    calloutIcon: {
      label: 'Callout icon', type: 'icon', group: 'callout', placeholder: 'fas fa-circle-info', showIf: { layout: 'callout' },
      description: 'Shown before the text, in the accent colour. Empty = none.',
    },
    align: {
      label: 'Alignment', type: 'select', display: 'segmented', value: 'start', group: 'text', required: true,
      options: [opt('start', 'Left'), opt('center', 'Centre'), opt('end', 'Right')],
    },
    verticalAlign: {
      label: 'Vertical position', type: 'select', display: 'segmented', value: 'top', group: 'text', required: true, advanced: true,
      options: [opt('top', 'Top'), opt('center', 'Middle'), opt('bottom', 'Bottom')],
    },
    textSize: {
      label: 'Text size', type: 'select', display: 'segmented', value: 'md', group: 'text', required: true,
      options: [opt('sm', 'Small'), opt('md', 'Medium'), opt('lg', 'Large')],
    },
    textFont: fontField('Text font', 'text', { advanced: true, description: 'A size here overrides the text size above.' }),
    textColor: colorField('Text colour', 'text', 'var(--text-primary)'),
    headingFont: fontField('Heading font', 'text', { advanced: true }),
    headingColor: colorField('Heading colour', 'text', undefined, { advanced: true, description: 'Empty = the text colour.' }),
    linkColor: colorField('Link colour', 'text', 'var(--primary)', { advanced: true }),
    linkUnderline: {
      label: 'Underline links', type: 'select', display: 'segmented', value: 'hover', group: 'text', required: true, advanced: true,
      options: [opt('hover', 'On hover'), opt('always', 'Always')],
    },
    padding: { label: 'Inner padding (px)', type: 'number', min: 0, max: 48, value: 0, group: 'text', advanced: true },
    overflow: {
      label: 'When the text is longer than the card', type: 'select', display: 'segmented', value: 'scroll', group: 'overflow', required: true,
      options: [opt('scroll', 'Scroll'), opt('clamp', 'Cut off after some lines')],
    },
    clampLines: { label: 'Lines to show', type: 'number', min: 1, max: 40, value: 6, group: 'overflow', showIf: { overflow: 'clamp' } },
    missingText: {
      label: 'When a field has no value', type: 'text', maxLength: 40, value: '—', group: 'record',
      description: 'Shown in place of a {{field}} the record does not have.',
    },
    showRecord: {
      label: 'List record values under the text', type: 'boolean', value: false, group: 'record',
      description: 'A footer with the record’s values as label / value rows.',
    },
    recordKeys: {
      label: 'Values in the footer', type: 'data-key', slot: 'record', multiple: true, max: 12, value: [], group: 'record',
      showIf: { showRecord: true }, description: 'Empty = every simple value of the record (up to 12).',
    },
  }),
  migrations: [],
};

export const CONTENT_MARKDOWN_KIND: BuiltinKindSpec = {
  type: 'content.markdown',
  label: 'Text',
  category: 'Content',
  description: 'Formatted text: headings, lists, links, bold, italic, code, and values from a bound record. HTML is shown as text, never run.',
  icon: 'fas fa-align-left',
  defaultW: 4,
  defaultH: 3,
  slots: [
    { key: 'record', label: 'Record for {{field}} values', shape: 'record', required: false },
  ],
  template: CONTENT_MARKDOWN,
};
