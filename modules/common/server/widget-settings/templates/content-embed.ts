// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/content-embed.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { safeEmbedRule } from '../views/content-logic';

/** `content.embed`: a public https page in a sandboxed frame. */
export const CONTENT_EMBED: SettingsTemplate = {
  id: 'builtin:content.embed',
  version: 1,
  namespace: '',
  label: 'Embed',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [], padding: 0 },
  groups: [
    { id: 'embed', label: 'Embedded page', tab: 'Display', since: 1 },
    { id: 'frame', label: 'Frame', tab: 'Display', since: 1 },
    { id: 'toolbar', label: 'Address bar', tab: 'Display', since: 1 },
    { id: 'behaviour', label: 'Refresh and permissions', tab: 'Behaviour', since: 1 },
  ],
  fields: since(1, {
    url: {
      label: 'Page address', type: 'url', maxLength: 2048, placeholder: 'https://…', group: 'embed',
      description: 'https only; private, loopback and single-label hosts are refused. The page runs sandboxed and cannot reach this app. '
        + 'Many sites refuse to be shown inside other pages; those stay blank.',
    },
    aspect: {
      label: 'Shape', type: 'select', display: 'segmented', value: 'fill', group: 'embed', required: true,
      options: [opt('fill', 'Fill the card'), opt('16:9', '16:9'), opt('4:3', '4:3'), opt('1:1', '1:1')],
    },
    zoom: {
      label: 'Zoom (%)', type: 'number', min: 25, max: 200, step: 5, value: 100, group: 'embed',
      description: 'Below 100 shows more of the page in a small card.',
    },
    border: { label: 'Border around the page', type: 'boolean', value: false, group: 'frame' },
    borderColor: colorField('Border colour', 'frame', 'var(--border)', { advanced: true, showIf: { border: true } }),
    radius: { label: 'Corner radius (px)', type: 'number', min: 0, max: 32, value: 0, group: 'frame', advanced: true },
    background: colorField('Background behind the page', 'frame', 'var(--surface-base)', {
      advanced: true, description: 'Shows while the page loads and around a page with a fixed shape.',
    }),
    showToolbar: {
      label: 'Show the address bar', type: 'boolean', value: true, group: 'toolbar',
      description: 'The site’s name, a hint for pages that refuse to be embedded, and a link to open the page in a new tab.',
    },
    toolbarPosition: {
      label: 'Position', type: 'select', display: 'segmented', value: 'bottom', group: 'toolbar', required: true, advanced: true,
      showIf: { showToolbar: true }, options: [opt('top', 'Above the page'), opt('bottom', 'Below the page')],
    },
    hintText: {
      label: 'Hint', type: 'text', maxLength: 120, group: 'toolbar', showIf: { showToolbar: true },
      value: 'Blank? The site may not allow embedding.',
      description: 'A browser shows nothing (or a broken page) when the site forbids framing; this tells the viewer why. Empty = none.',
    },
    openLabel: { label: 'Open link text', type: 'text', maxLength: 30, placeholder: 'Open', group: 'toolbar', advanced: true,
      showIf: { showToolbar: true } },
    refreshSeconds: {
      label: 'Reload every (seconds)', type: 'number', nullable: true, display: 'input', min: 10, max: 86400, group: 'behaviour',
      placeholder: 'Never', description: 'Reloads the page on a timer, for status pages without their own refresh.',
    },
    allowFullscreen: { label: 'Allow the page to go full screen', type: 'boolean', value: true, group: 'behaviour', advanced: true },
    sandboxAllow: {
      label: 'The page may', type: 'multi-select', group: 'behaviour', advanced: true,
      value: ['scripts', 'forms', 'popups', 'presentation'],
      options: [opt('scripts', 'Run scripts'), opt('forms', 'Submit forms'), opt('popups', 'Open new windows'), opt('presentation', 'Present')],
      description: 'Switch permissions off for a stricter frame. The page can never reach this app, its cookies or its storage '
        + '(no same-origin), nor navigate it; those are not offered.',
    },
  }),
  rules: [safeEmbedRule('url')],
  migrations: [],
};

export const CONTENT_EMBED_KIND: BuiltinKindSpec = {
  type: 'content.embed',
  label: 'Embed',
  category: 'Content',
  description: 'An external https page in a sandboxed frame.',
  icon: 'fas fa-window-maximize',
  defaultW: 6,
  defaultH: 5,
  slots: [{ key: 'record', label: 'Attributes for {{attr_key}} in the address', shape: 'record', required: false }],
  template: CONTENT_EMBED,
};
