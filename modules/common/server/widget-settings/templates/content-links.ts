// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/content-links.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, layoutField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { safeRowLinksRule } from '../views/content-logic';

/** `content.links`: quick links to internal pages or external addresses. */
export const CONTENT_LINKS: SettingsTemplate = {
  id: 'builtin:content.links',
  version: 1,
  namespace: '',
  label: 'Quick links',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [] },
  groups: [
    { id: 'layout', label: 'Layout', tab: 'Display', since: 1 },
    { id: 'links', label: 'Links', tab: 'Display', since: 1 },
    { id: 'items', label: 'Items', tab: 'Display', since: 1 },
    { id: 'style', label: 'Text', tab: 'Display', since: 1 },
    { id: 'icons', label: 'Icons', tab: 'Display', since: 1 },
    { id: 'behaviour', label: 'Behaviour', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    layout: layoutField([
      opt('list', 'List', 'links-list'),
      opt('grid', 'Cards', 'links-grid'),
      opt('tiles', 'Tiles', 'links-tiles'),
      opt('buttons', 'Buttons', 'links-buttons'),
    ]),
    columns: {
      label: 'Columns', type: 'select', display: 'segmented', value: 'auto', group: 'layout', required: true,
      showIf: { layout: ['grid', 'tiles'] },
      options: [opt('auto', 'Auto'), opt('1', '1'), opt('2', '2'), opt('3', '3'), opt('4', '4'), opt('6', '6')],
    },
    links: {
      label: 'Links', type: 'repeater', value: [], max: 24, group: 'links',
      description: 'Targets must be an internal path, https, http or mailto; anything else is dropped.',
      fields: {
        label: { label: 'Label', type: 'text', maxLength: 80, required: true },
        href: { label: 'Target', type: 'text', maxLength: 2048, required: true, placeholder: '/admin/users' },
        description: { label: 'Description', type: 'text', maxLength: 160 },
        icon: { label: 'Icon', type: 'icon', placeholder: 'fas fa-users' },
        iconColor: { label: 'Icon colour', type: 'color' },
        color: { label: 'Accent colour', type: 'color' },
      },
    },
    showDescription: { label: 'Show descriptions', type: 'boolean', value: true, group: 'items',
      showIf: { layout: ['list', 'grid', 'tiles'] }, description: 'Buttons show the description as a tooltip.' },
    divider: { label: 'Lines between list rows', type: 'boolean', value: true, group: 'items', showIf: { layout: 'list' } },
    itemColor: colorField('Item background', 'items', undefined, {
      advanced: true, description: 'Fill of cards, tiles and list rows. Empty = from the layout.',
    }),
    accentColor: colorField('Accent colour', 'items', 'var(--primary)', {
      description: 'Buttons are filled with it; cards, tiles and rows show it on hover. A link may set its own.',
    }),
    radius: { label: 'Corner radius (px)', type: 'number', nullable: true, display: 'input', min: 0, max: 32,
      placeholder: 'Theme', group: 'items', advanced: true },
    labelFont: fontField('Label font', 'style', { advanced: true }),
    labelColor: colorField('Label colour', 'style', 'var(--text-primary)'),
    descriptionFont: fontField('Description font', 'style', { advanced: true }),
    descriptionColor: colorField('Description colour', 'style', 'var(--text-secondary)', { advanced: true }),
    iconStyle: {
      label: 'Icon style', type: 'select', display: 'segmented', value: 'tile', group: 'icons', required: true,
      showIf: { layout: ['list', 'grid', 'tiles'] },
      options: [opt('tile', 'In a tinted tile'), opt('plain', 'Plain')],
    },
    iconColor: colorField('Icon colour', 'icons', 'var(--primary)', { description: 'A link may set its own.' }),
    iconSize: { label: 'Icon size (px)', type: 'number', min: 8, max: 64, value: 16, group: 'icons', advanced: true },
    externalMark: { label: 'Mark external links with ↗', type: 'boolean', value: true, group: 'behaviour' },
    openExternalInNewTab: { label: 'Open external links in a new tab', type: 'boolean', value: true, group: 'behaviour' },
  }),
  rules: [safeRowLinksRule('links', 'href')],
  migrations: [],
};

export const CONTENT_LINKS_KIND: BuiltinKindSpec = {
  type: 'content.links',
  label: 'Quick links',
  category: 'Content',
  description: 'Navigation cards to internal pages or external addresses.',
  icon: 'fas fa-link',
  defaultW: 6,
  defaultH: 3,
  slots: [{ key: 'record', label: 'Attributes for {{attr_key}} in an address', shape: 'record', required: false }],
  template: CONTENT_LINKS,
};
