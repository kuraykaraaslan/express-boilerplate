// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/content-image.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, fontField, opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { safeImageRule, safeLinkRule } from '../views/content-logic';

/** `content.image`: an image from an allow-listed address, with fit, filters, caption, overlay and an optional link. */
export const CONTENT_IMAGE: SettingsTemplate = {
  id: 'builtin:content.image',
  version: 1,
  namespace: '',
  label: 'Image',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [], padding: 0 },
  groups: [
    { id: 'image', label: 'Image', tab: 'Display', since: 1 },
    { id: 'display', label: 'Display', tab: 'Display', since: 1 },
    { id: 'effects', label: 'Overlay and filters', tab: 'Display', since: 1 },
    { id: 'caption', label: 'Caption', tab: 'Display', since: 1 },
    { id: 'link', label: 'Link', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    src: {
      label: 'Image address', type: 'url', maxLength: 2000, placeholder: 'https://… or /uploads/…', group: 'image',
      description: 'An internal path or an https / http address.',
    },
    alt: {
      label: 'Alternative text', type: 'text', maxLength: 300, group: 'image',
      description: 'Describe the image for screen readers. Empty marks it decorative.',
    },
    fit: {
      label: 'Fit', type: 'select', display: 'segmented', value: 'cover', group: 'display', required: true,
      options: [opt('cover', 'Cover'), opt('contain', 'Contain'), opt('fill', 'Stretch'), opt('none', 'Original size')],
    },
    position: {
      label: 'Position', type: 'select', value: 'center', group: 'display', required: true, advanced: true,
      options: [
        opt('center', 'Centre'), opt('top', 'Top'), opt('bottom', 'Bottom'), opt('left', 'Left'), opt('right', 'Right'),
        opt('top left', 'Top left'), opt('top right', 'Top right'), opt('bottom left', 'Bottom left'), opt('bottom right', 'Bottom right'),
      ],
    },
    radius: { label: 'Corner radius (px)', type: 'number', min: 0, max: 48, value: 0, group: 'display', advanced: true },
    background: colorField('Background', 'display', undefined, {
      advanced: true, description: 'Behind an image that does not fill the card (Contain, Original size). Empty = none.',
    }),
    zoomOnHover: { label: 'Zoom in on hover', type: 'boolean', value: false, group: 'effects' },
    overlayColor: colorField('Overlay colour', 'effects', undefined, {
      description: 'A colour laid over the image, e.g. to make a caption readable. Empty = none.',
    }),
    overlayOpacity: { label: 'Overlay strength (%)', type: 'number', min: 0, max: 100, step: 5, value: 30, group: 'effects',
      advanced: true, description: 'Applied to the overlay colour.' },
    grayscale: { label: 'Greyscale (%)', type: 'number', min: 0, max: 100, step: 5, value: 0, group: 'effects', advanced: true },
    brightness: { label: 'Brightness (%)', type: 'number', min: 20, max: 200, step: 5, value: 100, group: 'effects', advanced: true },
    caption: { label: 'Caption', type: 'text', maxLength: 200, group: 'caption' },
    captionPlacement: {
      label: 'Caption position', type: 'select', value: 'overlay', group: 'caption', required: true,
      options: [opt('overlay', 'On the image, bottom'), opt('overlay-top', 'On the image, top'), opt('below', 'Below the image'), opt('above', 'Above the image')],
    },
    captionAlign: {
      label: 'Caption alignment', type: 'select', display: 'segmented', value: 'start', group: 'caption', required: true, advanced: true,
      options: [opt('start', 'Left'), opt('center', 'Centre'), opt('end', 'Right')],
    },
    captionFont: fontField('Caption font', 'caption', { advanced: true }),
    captionColor: colorField('Caption colour', 'caption', undefined, { advanced: true, description: 'Empty = from the theme.' }),
    captionBackground: colorField('Caption background', 'caption', undefined, {
      advanced: true, description: 'Empty = a frosted bar on the image, none below or above it.',
    }),
    href: {
      label: 'Link', type: 'text', maxLength: 2048, placeholder: '/admin or https://…', group: 'link',
      description: 'Optional. An internal path or an https / http / mailto address.',
    },
    openInNewTab: { label: 'Open external links in a new tab', type: 'boolean', value: true, group: 'link', advanced: true },
  }),
  rules: [safeImageRule('src'), safeLinkRule('href', 'Link')],
  migrations: [],
};

export const CONTENT_IMAGE_KIND: BuiltinKindSpec = {
  type: 'content.image',
  label: 'Image',
  category: 'Content',
  description: 'An image from an https address or an internal path, optionally a link.',
  icon: 'fas fa-image',
  defaultW: 4,
  defaultH: 3,
  slots: [
    { key: 'source', label: 'Image address', shape: 'scalar', required: false },
    { key: 'record', label: 'Attributes for {{attr_key}} in the link', shape: 'record', required: false },
  ],
  template: CONTENT_IMAGE,
};
