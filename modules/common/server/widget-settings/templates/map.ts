// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/map.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, minBelowMax, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate, Sparse } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** Only a path-absolute internal target: `/x`, never `//host`, `/\host`, a scheme or a control character. */
export function isInternalPath(to: unknown): to is string {
  if (typeof to !== 'string') return false;
  if (!/^\/(?![\/\\])/.test(to)) return false;
   
  if (/[\u0000-\u001f\u007f]/.test(to)) return false;
  return !/^\/\s*[a-z][a-z0-9+.-]*:/i.test(to);
}

/** A link template must be an internal path before any `{column}` is expanded. */
export const internalLinkRule = (key: string) => (v: Sparse) =>
  typeof v[key] === 'string' && v[key] !== '' && !isInternalPath(v[key])
    ? [{ path: key, message: 'The link must be an internal path that starts with a single /' }]
    : [];

/** `map`: bound rows with coordinates as markers, plus optional zones (polygons) and routes (lines). */
export const MAP: SettingsTemplate = {
  id: 'builtin:map',
  version: 2,
  namespace: '',
  label: 'Map',
  format: false,
  exportable: true,
  cardDefaults: { padding: 0 },
  groups: [
    // An image (floor-plan) map (next-boilerplate 20.3d): purely additive, so no version bump.
    { id: 'kind', label: 'Map kind', tab: 'Display', since: 1 },
    { id: 'columns', label: 'Columns', tab: 'Data', since: 1 },
    { id: 'markers', label: 'Markers', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Marker colour', tab: 'Display', since: 1 },
    { id: 'legend', label: 'Legend', tab: 'Display', since: 1 },
    { id: 'tooltip', label: 'Labels and tooltips', tab: 'Display', since: 1 },
    { id: 'view', label: 'View', tab: 'Display', since: 1 },
    { id: 'controls', label: 'Map controls', tab: 'Behaviour', since: 1 },
    { id: 'click', label: 'Click', tab: 'Behaviour', since: 1 },
    // Zones and routes (next-boilerplate 20.3d): purely additive optional slots, so no version bump.
    { id: 'zones', label: 'Zones', tab: 'Data', since: 1 },
    { id: 'routes', label: 'Routes', tab: 'Data', since: 1 },
  ],
  fields: {
    ...since(1, {
    mapKind: {
      label: 'Map', type: 'select', display: 'segmented', value: 'geo', group: 'kind', required: true,
      options: [opt('geo', 'Geographic'), opt('image', 'Image (floor plan)')],
      description: 'An image map draws a picture instead of map tiles; the latitude and longitude columns then hold y and x in the picture\'s pixels, from its top-left corner.',
    },
    imageSrc: {
      label: 'Image', type: 'text', maxLength: 500, placeholder: '/files/floor-1.png', group: 'kind', showIf: { mapKind: 'image' },
      description: 'An internal path or an https address.',
    },
    imageWidth: { label: 'Image width (px)', type: 'number', nullable: true, display: 'input', min: 1, max: 20000, group: 'kind', showIf: { mapKind: 'image' } },
    imageHeight: { label: 'Image height (px)', type: 'number', nullable: true, display: 'input', min: 1, max: 20000, group: 'kind', showIf: { mapKind: 'image' } },
    latColumn: { label: 'Latitude column', type: 'data-key', slot: 'points', value: 'lat', required: true, group: 'columns' },
    lngColumn: { label: 'Longitude column', type: 'data-key', slot: 'points', value: 'lng', required: true, group: 'columns' },
    labelColumn: { label: 'Label column', type: 'data-key', slot: 'points', value: 'label', group: 'columns', description: 'The marker\'s name: its tooltip title and its label on the map.' },
    idColumn: {
      label: 'Row id column', type: 'data-key', slot: 'points', group: 'columns', advanced: true,
      description: 'Identifies the marker in click actions. Empty = the row number.',
    },
    markerStyle: {
      label: 'Marker', type: 'select', display: 'segmented', value: 'pin', group: 'markers', required: true,
      options: [opt('pin', 'Pin'), opt('dot', 'Dot'), opt('circle', 'Circle'), opt('icon', 'Icon')],
    },
    markerIcon: { label: 'Marker icon', type: 'icon', group: 'markers', placeholder: 'fas fa-location-dot', showIf: { markerStyle: 'icon' } },
    markerSize: { label: 'Marker size (px)', type: 'number', min: 8, max: 64, value: 24, group: 'markers' },
    cluster: {
      label: 'Group nearby markers', type: 'boolean', value: false, group: 'markers',
      description: 'Markers that overlap become one bubble with a count (in their shared colour); clicking it zooms in.',
    },
    clusterRadius: { label: 'Grouping distance (px)', type: 'number', min: 10, max: 200, value: 40, group: 'markers', advanced: true, showIf: { cluster: true } },
    colorBy: {
      label: 'Colour from', type: 'select', display: 'segmented', value: 'column', group: 'colour', required: true,
      options: [opt('fixed', 'One colour'), opt('column', 'A status column'), opt('ranges', 'Ranges on a value')],
    },
    markerColor: colorField('Marker colour', 'colour', 'var(--primary)', {
      description: 'Also used when a row has no colour of its own.',
    }),
    colorColumn: {
      label: 'Status column', type: 'data-key', slot: 'points', value: 'status', group: 'colour', showIf: { colorBy: 'column' },
      description: 'Its value picks the colour: a value named below, a status word (Online, Warning, Offline…), a colour name (success, warning, error, info, neutral, primary) or a CSS colour.',
    },
    valueColors: {
      label: 'Status colours', type: 'repeater', group: 'colour', max: 20, value: [], showIf: { colorBy: 'column' },
      description: 'Maps a value of the status column (case does not matter) to a colour and a legend label.',
      fields: {
        value: { label: 'Value', type: 'text', maxLength: 80, required: true, placeholder: 'Online' },
        color: { label: 'Colour', type: 'color', value: 'var(--success)' },
        label: { label: 'Shown as', type: 'text', maxLength: 40, placeholder: 'The value' },
        icon: { label: 'Glyph', type: 'icon', placeholder: 'fas fa-truck', description: 'Marks this status with a glyph instead of the marker style.' },
        image: { label: 'Picture', type: 'text', maxLength: 500, placeholder: '/files/pump-alarm.svg', description: 'An internal path or an https address. Wins over the glyph.' },
      },
    },
    valueColumn: { label: 'Value column', type: 'data-key', slot: 'points', group: 'colour', showIf: { colorBy: 'ranges' } },
    ...rangesFields('The first range the value falls in colours the marker.', 'colour'),
    legend: {
      label: 'Show a legend', type: 'boolean', value: true, group: 'legend',
      description: 'What each colour means, with a count per status. Hidden with one colour.',
    },
    legendPosition: {
      label: 'Legend corner', type: 'select', value: 'bottomleft', group: 'legend', required: true, showIf: { legend: true },
      options: [opt('bottomleft', 'Bottom left'), opt('bottomright', 'Bottom right'), opt('topleft', 'Top left'), opt('topright', 'Top right')],
    },
    tooltipTrigger: {
      label: 'Open tooltips on', type: 'select', display: 'segmented', value: 'hover', group: 'tooltip', required: true,
      options: [opt('hover', 'Hover'), opt('click', 'Click'), opt('none', 'Never')],
      description: 'A click-opened tooltip stays open, so its link can be used.',
    },
    tooltipColumns: {
      label: 'Tooltip fields', type: 'data-key', slot: 'points', multiple: true, max: 6, value: [], group: 'tooltip',
      description: 'Shown as label / value rows under the title, titled and formatted as the query declares them.',
    },
    tileStyle: {
      label: 'Map style', type: 'select', value: 'auto', group: 'view', required: true, showIf: { mapKind: 'geo' },
      options: [
        opt('auto', 'Follow the theme'), opt('light', 'Light'), opt('grey', 'Light, no labels'),
        opt('dark', 'Dark'), opt('streets', 'Streets (colour)'), opt('satellite', 'Satellite'),
      ],
      description: 'Follow the theme: light or dark with the app, or the platform\'s tile server when one is configured.',
    },
    fitBounds: { label: 'Fit the view to the markers', type: 'boolean', value: true, group: 'view' },
    fitPadding: { label: 'Space around the markers (px)', type: 'number', min: 0, max: 200, value: 32, group: 'view', advanced: true, showIf: { fitBounds: true } },
    centerLat: {
      label: 'Centre latitude', type: 'number', nullable: true, display: 'input', min: -90, max: 90, group: 'view',
      description: 'Where the map looks when it does not fit to the markers (or there are none).',
    },
    centerLng: { label: 'Centre longitude', type: 'number', nullable: true, display: 'input', min: -180, max: 180, group: 'view' },
    zoom: { label: 'Zoom', type: 'number', min: 1, max: 18, value: 4, group: 'view', showIf: { fitBounds: false } },
    minZoom: { label: 'Minimum zoom', type: 'number', nullable: true, display: 'input', min: 0, max: 20, group: 'view', advanced: true },
    maxZoom: { label: 'Maximum zoom', type: 'number', nullable: true, display: 'input', min: 0, max: 20, group: 'view', advanced: true },
    zoomButtons: { label: 'Zoom buttons', type: 'boolean', value: true, group: 'controls' },
    controlsPosition: {
      label: 'Zoom buttons corner', type: 'select', value: 'topleft', group: 'controls', required: true, showIf: { zoomButtons: true },
      options: [opt('topleft', 'Top left'), opt('topright', 'Top right'), opt('bottomleft', 'Bottom left'), opt('bottomright', 'Bottom right')],
    },
    draggable: {
      label: 'Markers can be dragged', type: 'boolean', value: false, group: 'click', showIf: { mapKind: 'image' },
      description: 'On a floor plan: the viewer drops a marker where it belongs and the placement\'s command receives { id, x, y } (whole pixels). Save, then choose the command under Actions; without one the markers stay put.',
    },
    replay: {
      label: 'Replay controls', type: 'boolean', value: false, group: 'routes',
      description: 'Play, pause and scrub the routes: a moving point follows each, with its start and end marked. A third value per point (a time) makes the replay follow the clock.',
    },
    replaySpeed: {
      label: 'Replay speed', type: 'select', display: 'segmented', value: '1', group: 'routes', required: true, showIf: { replay: true },
      options: [opt('1', '1×'), opt('2', '2×'), opt('5', '5×'), opt('10', '10×')],
    },
    layerToggles: {
      label: 'Layer switch', type: 'boolean', value: true, group: 'controls',
      description: 'Lets viewers show or hide markers, zones and routes. Shown only when the map has more than one of them.',
    },
    layerTogglesPosition: {
      label: 'Layer switch corner', type: 'select', value: 'topright', group: 'controls', required: true, showIf: { layerToggles: true },
      options: [opt('topright', 'Top right'), opt('topleft', 'Top left'), opt('bottomright', 'Bottom right'), opt('bottomleft', 'Bottom left')],
    },
    scrollZoom: {
      label: 'Zoom with the mouse wheel', type: 'boolean', value: false, group: 'controls',
      description: 'Off: the wheel scrolls the board past the map; use the buttons or a pinch to zoom.',
    },
    linkTemplate: {
      label: 'Marker link', type: 'text', maxLength: 300, placeholder: '/admin/devices/{id}', group: 'click', advanced: true,
      description: 'Internal path only; {column} is replaced by the clicked row\'s value. Empty = markers are not links. Click actions run either way.',
    },
    linkLabel: { label: 'Link text', type: 'text', maxLength: 40, placeholder: 'Open', group: 'click', advanced: true },
    zonePositionsColumn: {
      label: 'Zone outline column', type: 'data-key', slot: 'zones', value: 'positions', group: 'zones',
      description: 'A list of [latitude, longitude] corners (or that list as JSON text). Rows without three valid corners are skipped.',
    },
    zoneLabelColumn: { label: 'Zone name column', type: 'data-key', slot: 'zones', value: 'name', group: 'zones' },
    zoneVariant: {
      label: 'Zone colour', type: 'select', value: 'info', group: 'zones', required: true,
      options: [opt('primary', 'Primary'), opt('info', 'Info'), opt('success', 'Success'), opt('warning', 'Warning'), opt('error', 'Error'), opt('neutral', 'Neutral')],
    },
    zoneVariantColumn: {
      label: 'Zone colour column', type: 'data-key', slot: 'zones', group: 'zones', advanced: true,
      description: 'A column whose value is one of primary, info, success, warning, error or neutral; anything else uses the zone colour.',
    },
    zoneOpacity: { label: 'Zone fill opacity', type: 'number', min: 0, max: 1, step: 0.05, value: 0.2, group: 'zones' },
    routePositionsColumn: {
      label: 'Route path column', type: 'data-key', slot: 'routes', value: 'positions', group: 'routes',
      description: 'A list of [latitude, longitude] points in order (or that list as JSON text). Rows without two valid points are skipped.',
    },
    routeLabelColumn: { label: 'Route name column', type: 'data-key', slot: 'routes', value: 'name', group: 'routes' },
    routeColor: colorField('Route colour', 'routes', 'var(--primary)'),
    routeWeight: { label: 'Route width (px)', type: 'number', min: 1, max: 12, value: 3, group: 'routes' },
    routeDashed: { label: 'Dashed routes', type: 'boolean', value: false, group: 'routes' },
  }),
    // Version 2: when a name is shown, and privacy (the overlay standard). `labelMode` replaces the on / off switch `showLabels`.
    ...since(2, {
      labelMode: {
        label: 'Show names', type: 'select', display: 'segmented', value: 'none', group: 'tooltip', required: true,
        options: [opt('always', 'Always'), opt('alerts', 'Alerts only'), opt('none', 'Never')],
        description: 'The name beside a marker. Alerts only names the markers whose status column says a warning or worse. Tooltips open as set below either way.',
      },
      roleColumn: {
        label: 'Role column', type: 'data-key', slot: 'points', group: 'columns', advanced: true,
        description: 'The marker\'s role (a worker, a visitor). It is the label in privacy mode.',
      },
      alertColumn: {
        label: 'Alert column', type: 'data-key', slot: 'points', group: 'columns', advanced: true,
        description: 'A column whose value says a marker is in trouble (warning, critical, alarm, SOS, fall…). Empty = the status column the colours come from.',
      },
      labelAnonymous: {
        label: 'Privacy mode', type: 'boolean', value: false, group: 'tooltip',
        description: 'Names stay out of the page: a marker is labelled with its role, and the label column and the columns below are left out of tooltips, links and clicks.',
      },
      identityColumns: {
        label: 'Columns that identify', type: 'data-key', slot: 'points', multiple: true, max: 8, value: [], group: 'tooltip', showIf: { labelAnonymous: true },
        description: 'A badge number, a company, a phone: anything besides the label column that says who it is.',
      },
    }),
  },
  rules: [
    minBelowMax('minZoom', 'maxZoom'), internalLinkRule('linkTemplate'),
    // An image map needs its picture and its size: the size places the points, the picture is only drawn.
    (v: Sparse) => (v.mapKind === 'image' && !(typeof v.imageSrc === 'string' && v.imageSrc.trim() && typeof v.imageWidth === 'number' && typeof v.imageHeight === 'number')
      ? [{ path: 'imageSrc', message: 'An image map needs an image and its width and height' }] : []),
  ],
  migrations: [
    {
      from: 1, to: 2,
      note: 'Show labels is now "Show names": always, alerts only or never.',
      ops: [{ op: 'rename', from: 'showLabels', to: 'labelMode' }, { op: 'mapValue', key: 'labelMode', map: { true: 'always', false: 'none' } }],
    },
  ],
};

export const MAP_KIND: BuiltinKindSpec = {
  type: 'map',
  label: 'Map',
  category: 'Maps & Location',
  description: 'Bound table rows with coordinates, plotted as markers on a map.',
  icon: 'fas fa-map-location-dot',
  defaultW: 6,
  defaultH: 5,
  slots: [
    { key: 'points', label: 'Points', shape: 'table', required: true },
    { key: 'zones', label: 'Zones', shape: 'table', required: false },
    { key: 'routes', label: 'Routes', shape: 'table', required: false },
    { key: 'image', label: 'Floor plan address', shape: 'scalar', required: false },
  ],
  template: MAP,
};
