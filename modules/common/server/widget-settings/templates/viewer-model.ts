// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/viewer-model.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { colorField, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate, Sparse } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { safeModelUrlsRule } from '../views/content-logic';
import { MAX_RULE_LABEL, MAX_SCENE_RULES, validateRules } from '../views/scene-rules-logic';
import { DEFAULT_THING_SIZE, MAX_THING_LABELS, MAX_THINGS, THING_KINDS, VIEWER_RULE_EFFECTS } from '../views/viewer-model-logic';
import { ruleConditionFields, stopField, YES_NO } from './rule-fields';

/**
 * `viewer.model`: IFC/BIM models in a 3D viewer (kui-viewer), with bound table rows as live sensor markers and, since
 * v2, a second table of things (one row = one object standing on its point, drawn as a simple instanced shape) and
 * rules that colour, hide, label, pulse, resize or lift markers and things from their rows or the board's parameters.
 */
export const VIEWER_MODEL: SettingsTemplate = {
  id: 'builtin:viewer.model',
  version: 3,
  namespace: '',
  label: '3D model',
  format: false,
  exportable: true,
  cardDefaults: { padding: 0 },
  groups: [
    { id: 'models', label: 'Models', tab: 'Display', since: 1 },
    { id: 'columns', label: 'Sensor columns', tab: 'Data', since: 1 },
    { id: 'things', label: 'Things', tab: 'Data', since: 2 },
    { id: 'rules', label: 'Rules', tab: 'Data', since: 2 },
    { id: 'markers', label: 'Sensor markers', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Marker and thing colour', tab: 'Display', since: 1 },
    { id: 'legend', label: 'Legend', tab: 'Display', since: 1 },
    { id: 'tooltip', label: 'Labels and tooltips', tab: 'Display', since: 1 },
    { id: 'scene', label: 'Scene', tab: 'Display', since: 1 },
    { id: 'camera', label: 'Camera', tab: 'Behaviour', since: 1 },
  ],
  fields: {
    ...since(1, {
    models: {
      label: 'Models', type: 'repeater', group: 'models', max: 8, value: [],
      description: 'IFC files loaded together as one federated scene, in this order. An internal path (/…) or an https address '
        + '(the other site must allow it with CORS).',
      fields: {
        url: { label: 'Address', type: 'url', maxLength: 2048, required: true, placeholder: '/samples/plant/Plant-Structure.ifc' },
        label: { label: 'Name', type: 'text', maxLength: 60, placeholder: 'Structure' },
        visible: { label: 'Show', type: 'boolean', value: true },
      },
    },
    idColumn: {
      label: 'Sensor id column', type: 'data-key', slot: 'sensors', value: 'id', group: 'columns',
      description: 'Identifies the sensor. Empty = the row number.',
    },
    labelColumn: { label: 'Label column', type: 'data-key', slot: 'sensors', value: 'label', group: 'columns', description: 'The sensor\'s name: its tooltip title and its label in the model.' },
    xColumn: { label: 'X column', type: 'data-key', slot: 'sensors', value: 'x', required: true, group: 'columns' },
    yColumn: { label: 'Y column', type: 'data-key', slot: 'sensors', value: 'y', required: true, group: 'columns' },
    zColumn: { label: 'Z column', type: 'data-key', slot: 'sensors', value: 'z', required: true, group: 'columns' },
    coordinates: {
      label: 'Coordinates are', type: 'select', value: 'z-up', group: 'columns', required: true, advanced: true,
      options: [opt('z-up', 'Model coordinates (Z up, as in IFC)'), opt('y-up', 'Scene coordinates (Y up)')],
      description: 'In metres, for the sensors and the things alike. Model coordinates are what an IFC authoring tool shows; rows without three numbers are not placed.',
    },
    valueColumn: {
      label: 'Reading column', type: 'data-key', slot: 'sensors', value: 'value', group: 'columns',
      description: 'The live value shown on the marker and in its tooltip; colour ranges apply to it.',
    },
    unitColumn: { label: 'Unit column', type: 'data-key', slot: 'sensors', value: 'unit', group: 'columns', advanced: true },
    markerSize: { label: 'Marker size (px)', type: 'number', min: 8, max: 40, value: 14, group: 'markers' },
    pulseAlarms: {
      label: 'Pulse markers in an alarm colour', type: 'boolean', value: true, group: 'markers',
      description: 'A marker whose colour is the error tone draws the eye with a soft pulse.',
    },
    colorBy: {
      label: 'Colour from', type: 'select', display: 'segmented', value: 'column', group: 'colour', required: true,
      options: [opt('fixed', 'One colour'), opt('column', 'A status column'), opt('ranges', 'Ranges on the reading')],
      description: 'A thing takes its colour the same way, from the same columns of its own row.',
    },
    markerColor: colorField('Marker colour', 'colour', 'var(--primary)', {
      description: 'Also used when a row has no colour of its own.',
    }),
    colorColumn: {
      label: 'Status column', type: 'data-key', slot: 'sensors', value: 'status', group: 'colour', showIf: { colorBy: 'column' },
      description: 'Its value picks the colour: a value named below, a status word (Normal, Warning, Alarm…), a colour name (success, warning, error, info, neutral, primary) or a CSS colour.',
    },
    valueColors: {
      label: 'Status colours', type: 'repeater', group: 'colour', max: 20, value: [], showIf: { colorBy: 'column' },
      description: 'Maps a value of the status column (case does not matter) to a colour and a legend label.',
      fields: {
        value: { label: 'Value', type: 'text', maxLength: 80, required: true, placeholder: 'Alarm' },
        color: { label: 'Colour', type: 'color', value: 'var(--error)' },
        label: { label: 'Shown as', type: 'text', maxLength: 40, placeholder: 'The value' },
      },
    },
    ...rangesFields('The first range the reading falls in colours the marker.', 'colour'),
    legend: {
      label: 'Show a legend', type: 'boolean', value: true, group: 'legend',
      description: 'What each colour means, with a count per status. Hidden with one colour.',
    },
    legendPosition: {
      label: 'Legend corner', type: 'select', value: 'bottomleft', group: 'legend', required: true, showIf: { legend: true },
      options: [opt('bottomleft', 'Bottom left'), opt('bottomright', 'Bottom right'), opt('topleft', 'Top left'), opt('topright', 'Top right')],
    },
    labelContent: {
      label: 'Label shows', type: 'select', display: 'segmented', value: 'both', group: 'tooltip', required: true, showIf: { labelMode: ['always', 'alerts'] },
      options: [opt('label', 'Name'), opt('value', 'Reading'), opt('both', 'Name and reading')],
    },
    tooltipTrigger: {
      label: 'Open tooltips on', type: 'select', display: 'segmented', value: 'hover', group: 'tooltip', required: true,
      options: [opt('hover', 'Hover'), opt('click', 'Click'), opt('none', 'Never')],
    },
    tooltipColumns: {
      label: 'Tooltip fields', type: 'data-key', slot: 'sensors', multiple: true, max: 6, value: [], group: 'tooltip',
      description: 'Shown as label / value rows under the reading, titled and formatted as the query declares them.',
    },
    background: colorField('Background', 'scene', undefined, {
      description: 'Behind the model. Empty = follows the theme (light or dark with the app).',
    }),
    showNavCube: { label: 'Show the view cube', type: 'boolean', value: true, group: 'scene', description: 'Click a face to look from that side.' },
    showGrid: { label: 'Show a ground grid', type: 'boolean', value: false, group: 'scene' },
    cameraPreset: {
      label: 'Start view', type: 'select', display: 'segmented', value: 'iso', group: 'camera', required: true,
      options: [opt('iso', 'Isometric'), opt('top', 'Top'), opt('front', 'Front')],
    },
    autoFitOnLoad: {
      label: 'Fit the view to the models when they load', type: 'boolean', value: true, group: 'camera',
      description: 'Off: the camera stays where the viewer starts it.',
    },
    interactive: {
      label: 'Let viewers orbit, pan and zoom', type: 'boolean', value: true, group: 'camera',
      description: 'Off: the view is locked to the start view (markers still show their tooltips).',
    },
    scrollZoom: {
      label: 'Zoom with the mouse wheel', type: 'boolean', value: false, group: 'camera', showIf: { interactive: true },
      description: 'Off: the wheel scrolls the board past the model; drag to orbit, right-drag to pan.',
    },
    }),
    // Version 2: things from rows (the dashboard's `things` contract: id, kind, x, y, z, heading, label, status, value)
    // and rules on markers and things.
    ...since(2, {
    thingIdColumn: {
      label: 'Thing id column', type: 'data-key', slot: 'things', value: 'id', group: 'things',
      description: `Identifies a thing from one refresh to the next (a tag, a badge, a plate). Empty = the row number. At most ${MAX_THINGS} things are drawn.`,
    },
    thingKindColumn: {
      label: 'Kind column', type: 'data-key', slot: 'things', value: 'kind', group: 'things',
      description: 'box, sphere, cylinder or pin per row; a row without one is drawn as the kind below.',
    },
    thingKind: {
      label: 'Kind', type: 'select', display: 'segmented', value: 'box', group: 'things', required: true,
      options: [opt('box', 'Box'), opt('sphere', 'Sphere'), opt('cylinder', 'Cylinder'), opt('pin', 'Pin')],
      description: 'Drawn for every row the kind column does not decide. A thing stands on its point; a box and a cylinder point the way their heading says.',
    },
    thingXColumn: { label: 'X column', type: 'data-key', slot: 'things', value: 'x', group: 'things' },
    thingYColumn: { label: 'Y column', type: 'data-key', slot: 'things', value: 'y', group: 'things' },
    thingZColumn: { label: 'Z column', type: 'data-key', slot: 'things', value: 'z', group: 'things', description: 'Metres, in the sensors\' coordinates ("Coordinates are"). Rows without three numbers are not placed.' },
    thingHeadingColumn: {
      label: 'Heading column', type: 'data-key', slot: 'things', value: 'heading', group: 'things',
      description: 'Degrees, 0 = north (the model\'s +Y side), clockwise seen from above. Empty = 0.',
    },
    thingLabelColumn: { label: 'Label column', type: 'data-key', slot: 'things', value: 'label', group: 'things' },
    thingSize: {
      label: 'Size (m)', type: 'number', display: 'input', min: 0.05, max: 100, step: 0.05, value: DEFAULT_THING_SIZE, group: 'things',
      description: 'The long side of a thing, in metres. A size column per row wins.',
    },
    thingSizeColumn: { label: 'Size column', type: 'data-key', slot: 'things', group: 'things', advanced: true, description: 'Metres per row. Empty = the size above.' },
    rules: {
      label: 'Rules', type: 'repeater', group: 'rules', max: MAX_SCENE_RULES,
      description: 'Make the sensor markers and the things follow the data. A rule names a target (a marker or thing id from the bound rows, or *), up to two conditions on its row, another row or a board parameter, and what to change while they hold. Rules run top to bottom; every rule that matches applies, a later rule wins for the same change, and "Stop" ends the rules for that target.',
      fields: {
        ...ruleConditionFields({
          targetPlaceholder: 'TT-1, a thing id or *',
          targetDescription: 'A sensor marker id, a thing id (their id columns), or * for all of them.',
          ownRow: 'Its own row',
          otherRow: 'The id of another marker or thing whose row is read.',
          keyPlaceholder: 'value, status, zone',
        }),
        color: { label: 'Then: colour', type: 'color', description: 'Replaces the marker\'s or the thing\'s colour.' },
        hidden: { label: 'Hide', type: 'select', options: YES_NO },
        label: { label: 'Label', type: 'text', maxLength: MAX_RULE_LABEL, placeholder: 'High: {value}', description: 'Tokens: {value}, {value2}, {condition} (what the condition reads), {label}, {id}, {param:name}.' },
        pulse: { label: 'Pulse', type: 'select', options: YES_NO, description: 'The soft pulse an alarm draws: a marker rings, a thing breathes in size. Not when the viewer asks for reduced motion.' },
        size: { label: 'Size', type: 'number', nullable: true, display: 'input', min: 0, placeholder: 'No change', description: 'A marker: pixels. A thing: metres.' },
        dz: { label: 'Lift (m)', type: 'number', nullable: true, display: 'input', placeholder: '0', description: 'Moves it up (or down, negative) by this many metres.' },
        stop: stopField(),
      },
    },
    }),
    // Version 3: when a name is shown, and privacy (the overlay standard). `labelMode` and `thingLabelMode` replace the on / off switches
    // `showSensorLabels` and `showThingLabels`.
    ...since(3, {
      labelMode: {
        label: 'Show names beside sensors', type: 'select', display: 'segmented', value: 'always', group: 'tooltip', required: true,
        options: [opt('always', 'Always'), opt('alerts', 'Alerts only'), opt('none', 'Never')],
        description: 'Alerts only names the markers whose colour is the error tone or whose alert column says a warning or worse. Tooltips open as set below either way.',
      },
      thingLabelMode: {
        label: 'Show names on things', type: 'select', display: 'segmented', value: 'always', group: 'things', required: true,
        options: [opt('always', 'Always'), opt('alerts', 'Alerts only'), opt('none', 'Never')],
        description: `The ${MAX_THING_LABELS} things nearest the camera carry their label (the ones in trouble first).`,
      },
      roleColumn: {
        label: 'Role column', type: 'data-key', slot: 'sensors', group: 'columns', advanced: true,
        description: 'The role of a marker or a thing (a worker, a visitor). It is the label in privacy mode.',
      },
      alertColumn: {
        label: 'Alert column', type: 'data-key', slot: 'sensors', group: 'columns', advanced: true,
        description: 'A column whose value says a marker or a thing is in trouble (warning, critical, alarm, SOS, fall…). Empty = the error colour says so.',
      },
      labelAnonymous: {
        label: 'Privacy mode', type: 'boolean', value: false, group: 'tooltip',
        description: 'Names stay out of the page: a marker or a thing is labelled with its role, and the label columns and the columns below are left out of tooltips, rules and clicks.',
      },
      identityColumns: {
        label: 'Columns that identify', type: 'data-key', slot: 'sensors', multiple: true, max: 8, value: [], group: 'tooltip', showIf: { labelAnonymous: true },
        description: 'A badge number, a company, a phone: anything besides the label columns that says who it is.',
      },
    }),
  },
  rules: [
    safeModelUrlsRule('models'),
    // The targets are row ids the data brings; the settings can only check the shape of a rule.
    (v: Sparse) => validateRules(v.rules, { elementIds: [], fromData: true }, VIEWER_RULE_EFFECTS),
  ],
  migrations: [
    { from: 1, to: 2, note: 'Things from a second table (box, sphere, cylinder or pin per row) and rules on markers and things (all new).' },
    {
      from: 2, to: 3,
      note: 'The label switches are now "Show names": always, alerts only or never; a privacy mode is new.',
      ops: [
        { op: 'rename', from: 'showSensorLabels', to: 'labelMode' },
        { op: 'mapValue', key: 'labelMode', map: { true: 'always', false: 'none' } },
        { op: 'rename', from: 'showThingLabels', to: 'thingLabelMode' },
        { op: 'mapValue', key: 'thingLabelMode', map: { true: 'always', false: 'none' } },
      ],
    },
  ],
};

/** The kinds a thing may be, for a host that generates rows. */
export const VIEWER_THING_KINDS = THING_KINDS;

export const VIEWER_MODEL_KIND: BuiltinKindSpec = {
  type: 'viewer.model',
  label: '3D model',
  category: 'Maps & Location',
  group: 'viewer',
  description: 'IFC/BIM models in a 3D viewer, with bound table rows as live sensor markers and things.',
  icon: 'fas fa-cube',
  defaultW: 6,
  defaultH: 8,
  slots: [
    { key: 'sensors', label: 'Sensors', shape: 'table', required: false },
    { key: 'things', label: 'Things (one row each)', shape: 'table', required: false },
  ],
  template: VIEWER_MODEL,
};
