// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/content-video.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { opt, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { safeMediaRule, safeSubtitlesRule } from '../views/content-logic';

/**
 * `content.video`: a video played by kui-player, from an address in the settings or from a bound
 * value (e.g. a camera's stream address on a device attribute), which wins when it is a valid one.
 * MP4 / WebM play natively; HLS (`.m3u8`) through hls.js, loaded only for an HLS source.
 *
 * Version 2 adds the "Live" options (next-boilerplate iot-camera phase 05, OD-169): how often a stream asks "still
 * watching?" and whether it stops loading while the card is out of view. Nothing here knows what the source is (OD-173).
 */
export const CONTENT_VIDEO: SettingsTemplate = {
  id: 'builtin:content.video',
  version: 2,
  namespace: '',
  label: 'Video player',
  format: false,
  exportable: false,
  cardDefaults: { buttons: [], padding: 0 },
  groups: [
    { id: 'video', label: 'Video', tab: 'Display', since: 1 },
    { id: 'playback', label: 'Playback', tab: 'Display', since: 1 },
    { id: 'live', label: 'Live', tab: 'Display', since: 2 },
    { id: 'display', label: 'Display', tab: 'Display', since: 1 },
    { id: 'subtitles', label: 'Subtitles', tab: 'Display', since: 1 },
  ],
  fields: {
    ...since(1, {
    src: {
      label: 'Video address', type: 'url', maxLength: 2000, placeholder: 'https://…/video.mp4 or …/stream.m3u8', group: 'video',
      description: 'MP4, WebM or an HLS stream (.m3u8); an internal path or an https / http address. A bound value, when valid, takes its place.',
    },
    poster: {
      label: 'Poster image', type: 'url', maxLength: 2000, placeholder: 'https://… or /uploads/…', group: 'video',
      description: 'Shown before the video plays.',
    },
    autoPlay: {
      label: 'Start playing on its own', type: 'boolean', value: false, group: 'playback',
      description: 'Browsers allow this only for a muted video, so it starts muted; for a live stream nothing is loaded until play is pressed when this is off.',
    },
    startMuted: { label: 'Start muted', type: 'boolean', value: false, group: 'playback' },
    loop: { label: 'Loop', type: 'boolean', value: false, group: 'playback' },
    autoHideControls: { label: 'Hide the controls while playing', type: 'boolean', value: true, group: 'playback' },
    fit: {
      label: 'Fit', type: 'select', display: 'segmented', value: 'contain', group: 'display', required: true,
      options: [opt('contain', 'Whole video'), opt('cover', 'Fill the card')],
    },
    theme: {
      label: 'Player style', type: 'select', display: 'segmented', value: 'minimal', group: 'display', required: true, advanced: true,
      options: [opt('minimal', 'Minimal'), opt('broadcast', 'Broadcast'), opt('cinema', 'Cinema')],
    },
    showTitle: {
      label: 'Show the card title on the video', type: 'boolean', value: false, group: 'display', advanced: true,
      description: 'The player draws the title over the picture.',
    },
    subtitles: {
      label: 'Subtitle tracks', type: 'repeater', value: [], max: 12, group: 'subtitles',
      description: 'WebVTT files; the address must be an internal path or an https / http address.',
      fields: {
        label: { label: 'Label', type: 'text', maxLength: 40, required: true, placeholder: 'English' },
        srclang: { label: 'Language code', type: 'text', maxLength: 12, required: true, placeholder: 'en' },
        src: { label: 'File', type: 'text', maxLength: 2000, required: true, placeholder: '/uploads/en.vtt' },
      },
    },
  }),
    // Version 2: the live options. Both apply to a stream (HLS); a video file is never asked and never stopped.
    ...since(2, {
    presenceMinutes: {
      label: "Ask 'still watching?' every", type: 'select', display: 'segmented', value: '5', group: 'live', required: true,
      options: [opt('5', '5 minutes'), opt('10', '10 minutes'), opt('15', '15 minutes'), opt('off', 'Off')],
      description: 'After this much playing the viewer is asked; with no answer the stream stops loading, which saves what a running stream costs. All the video cards of a board share one question. Applies to streams, not to video files.',
    },
    stopWhenHidden: {
      label: 'Stop the stream when the card is out of view', type: 'boolean', value: true, group: 'live',
      description: 'A stream scrolled out of view, or in a hidden tab, stops loading and rejoins the live edge when it comes back.',
    },
    }),
  },
  rules: [safeMediaRule('src', 'The video address'), safeMediaRule('poster', 'The poster image'), safeSubtitlesRule('subtitles')],
  migrations: [
    {
      from: 1, to: 2,
      note: 'Live options: a stream asks "still watching?" every 5 minutes and stops while the card is out of view (both can be changed).',
      ops: [{ op: 'materializeDefault', key: 'presenceMinutes', value: '5' }, { op: 'materializeDefault', key: 'stopWhenHidden', value: true }],
    },
  ],
};

export const CONTENT_VIDEO_KIND: BuiltinKindSpec = {
  type: 'content.video',
  label: 'Video player',
  category: 'Content',
  description: 'A video or a live HLS stream, from an address or a bound value such as a camera’s stream.',
  icon: 'fas fa-circle-play',
  defaultW: 6,
  defaultH: 6,
  slots: [
    { key: 'source', label: 'Video address', shape: 'scalar', required: false },
    { key: 'sourceHigh', label: 'Higher quality address', shape: 'scalar', required: false },
  ],
  template: CONTENT_VIDEO,
};
