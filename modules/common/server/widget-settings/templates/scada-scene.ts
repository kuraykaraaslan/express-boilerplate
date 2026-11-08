// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/templates/scada-scene.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
import { colorField, opt, since } from '../settings/packs';
import type { SettingsTemplate, Sparse } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { isFormKey } from '../views/control-form-logic';
import { MAX_SCENE_ELEMENTS, MAX_SCENE_LINKS, MAX_SCENE_SHAPES, parsePort, type SceneElementSetting, type SceneLinkSetting, type SceneShapeSetting } from '../views/scada-scene-logic';
import { MAX_SCENE_OFFSET, RULE_PLACEMENT_LIVE, SCENE_OBJECT_ID, THINGS_TARGET } from '../views/scada-scene-things';
import { MAX_RULE_LABEL, MAX_SCENE_RULES, validateRules, type RuleIssue } from '../views/scene-rules-logic';
import { SYMBOL_RENAMES, isScadaSymbol, SCADA_SYMBOLS, SCADA_SYMBOL_DEFS, type SymbolDef } from '../views/scada-logic';
import { MEDIUM_OPTIONS, SYMBOL_OPTIONS } from './scada';
// The condition half of a rule row, the operator words and the yes / no choice are the kit's shared rules vocabulary (the 3D
// viewer's rules use the same piece), so every kind with rules stores and edits the same keys.
import { ruleConditionFields, stopField, YES_NO } from './rule-fields';

const DIAGRAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCENE_SLOT = /^[a-z][a-z0-9_-]{0,31}$/;
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).filter((r) => r && typeof r === 'object') : []);
const TURN_OPTIONS = [opt('0', '0°'), opt('90', '90°'), opt('180', '180°'), opt('270', '270°')];
/**
 * Said on each of a rule's placement fields while the kit's rule engine does not emit them (35.3 offered the fields before the
 * engine had them; `RULE_PLACEMENT_LIVE` probes it). The engine vendored at kui-react 47503e2 emits them, so the note is empty;
 * the probe stays as the guard should a vendor ever go back.
 */
const PLACEMENT_PENDING = RULE_PLACEMENT_LIVE ? '' : 'Takes effect with the next kit update; a script\'s scene patch can do it today.';
const pending = (description?: string): { description?: string } => {
  const text = [description, PLACEMENT_PENDING].filter(Boolean).join(' ');
  return text ? { description: text } : {};
};

/**
 * The rules engine's checks, less the ones a thing makes moot (35.3): a rule may target `things:*`, and a target or an "of row"
 * that names no authored symbol or connection may be a thing's id. Things come from data, so the template cannot know their
 * ids; an id outside the scene's grammar is still refused, and the scene skips a rule whose target is not there.
 */
function sceneRuleIssues(rules: unknown, ids: Set<string>, linkIds: string[]): RuleIssue[] {
  const rows = Array.isArray(rules) ? (rules as Array<Record<string, unknown>>) : [];
  return validateRules(rules, { elementIds: ids, linkIds }).filter((issue) => {
    const m = /^rules\.(\d+)\.(target|of|of2)$/.exec(issue.path);
    if (!m || issue.message !== 'No symbol or connection has this id') return true;
    const v = rows[Number(m[1])]?.[m[2]];
    const id = typeof v === 'string' ? v.trim() : '';
    return !((m[2] === 'target' && id === THINGS_TARGET) || SCENE_OBJECT_ID.test(id));
  });
}

/**
 * `scada.scene`: a process diagram on a canvas. Symbols are placed by coordinates, joined by pipes, hoses, cables, signal
 * wires and strip lines that route themselves between the symbols' sides (`pump1.r`, `tank.b`, `pump1.t:0.26`).
 * One bound table, a row per id, feeds every symbol and link (columns value, value2, running, status, warning, critical,
 * label, capacity).
 */
export const SCADA_SCENE: SettingsTemplate = {
  id: 'builtin:scada.scene',
  // Version 8 (e2e round 3, M-R3-13): the Picture choice (the device's own drawing or this card's). Version 9 (e2e round 4, B-R4-01): the
  // card's own drawing is picked from the saved drawings by name (no id), in the Picture group; the slot field speaks in words.
  version: 9,
  namespace: '',
  label: 'Process diagram',
  format: true,
  exportable: false,
  formatDefaults: { decimals: 1 },
  cardDefaults: { padding: 8, staleDisplay: 'dim' },
  groups: [
    // e2e round 3 (M-R3-13): which picture a card draws when the device it shows has a drawing of its own
    { id: 'picture', label: 'Picture', tab: 'Display', since: 8 },
    { id: 'canvas', label: 'Canvas', tab: 'Display', since: 1 },
    { id: 'elements', label: 'Symbols', tab: 'Display', since: 1 },
    { id: 'links', label: 'Connections', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Colours', tab: 'Display', since: 1 },
    { id: 'data', label: 'Data', tab: 'Data', since: 1 },
    { id: 'motion', label: 'Animation', tab: 'Display', since: 1 },
    { id: 'shapes', label: 'Titles and zones', tab: 'Display', since: 2 },
    { id: 'rules', label: 'Rules', tab: 'Data', since: 3 },
    // Version 6 (35.3): things from data, shown once the second table is bound.
    { id: 'things', label: 'Things', tab: 'Data', since: 6, showWhen: { slotBound: 'things' } },
    // Version 7 (phase 42.5): which of the page subject's drawings the card draws, when it has several (advanced; the drawing itself is picked under Picture since version 9).
    { id: 'diagram', label: 'Several drawings', tab: 'Data', since: 7 },
  ],
  fields: {
  ...since(1, {
    picture: {
      label: 'Picture', type: 'select', display: 'segmented', value: 'device', group: 'picture', required: true,
      options: [opt('device', 'The drawing chosen on the device\'s page'), opt('own', 'A drawing of this card\'s own')],
      description: 'A card follows the device shown on its page by default: the drawing chosen on that device\'s page (its Views tab) is drawn here with the device\'s values. A drawing of this card\'s own keeps one picture in this card whatever the device\'s page chooses: a saved drawing picked below, or the symbols drawn inside this card (Edit diagram).',
    },
    width: { label: 'Canvas width', type: 'number', display: 'input', min: 200, max: 4000, value: 1200, group: 'canvas', advanced: true, description: 'Scene units. The diagram scales to the card and keeps its proportions.' },
    height: { label: 'Canvas height', type: 'number', display: 'input', min: 200, max: 4000, value: 700, group: 'canvas', advanced: true },
    scale: { label: 'Symbol size', type: 'number', display: 'input', min: 0.2, max: 2, step: 0.05, value: 0.6, group: 'canvas', advanced: true, description: 'A symbol box is 100 units high at 1; connections are drawn at the same size, so a pipe matches the port it leaves.' },
    background: {
      label: 'Background', type: 'select', display: 'segmented', value: 'none', group: 'canvas', required: true,
      options: [opt('none', 'None'), opt('dots', 'Dots'), opt('panel', 'Panel')],
    },
    fit: {
      label: 'View', type: 'select', display: 'segmented', value: 'content', group: 'canvas', required: true,
      options: [opt('content', 'Fit to the diagram'), opt('canvas', 'The whole canvas')],
      description: 'Fit to the diagram zooms in on the symbols; the whole canvas keeps the empty space.',
    },
    anchor: {
      label: 'x and y are a symbol\'s', type: 'select', display: 'segmented', value: 'center', group: 'canvas', required: true,
      options: [opt('center', 'Centre'), opt('corner', 'Top-left corner')],
      description: 'Placing by centre lines symbols of different sizes up on one row.',
    },
    showLabels: { label: 'Show names and numbers around symbols', type: 'boolean', value: true, group: 'canvas' },
    elements: {
      // the symbol and connection lists are the drawing's own storage: a person draws in the editor, never here (e2e round 3, M-R3-04); a card that holds
      // its own symbols (a shipped board) still shows them in the basic mode, since a value differs from the default
      label: 'Symbols', type: 'repeater', group: 'elements', max: MAX_SCENE_ELEMENTS, advanced: true,
      description: 'The id names the symbol for connections and picks its row in the bound table; x and y place it on the canvas.',
      fields: {
        id: { label: 'Id', type: 'text', maxLength: 64, required: true, placeholder: 'pump1' },
        symbol: { label: 'Symbol', type: 'select', value: 'tank.vertical', required: true, options: SYMBOL_OPTIONS },
        x: { label: 'x', type: 'number', display: 'input', value: 0 },
        y: { label: 'y', type: 'number', display: 'input', value: 0 },
        turn: { label: 'Turn', type: 'select', value: '0', options: [opt('0', '0°'), opt('90', '90°'), opt('180', '180°'), opt('270', '270°')] },
        mirror: { label: 'Flip', type: 'boolean', value: false },
        length: { label: 'Length (cells)', type: 'select', value: '1', options: [opt('1', '1'), opt('2', '2'), opt('3', '3')] },
        scale: { label: 'Own size', type: 'number', nullable: true, display: 'input', min: 0.2, max: 4, step: 0.05, placeholder: '1' },
        label: { label: 'Name', type: 'text', maxLength: 60 },
        labelPos: { label: 'Name position', type: 'select', value: 'b', options: [opt('b', 'Below'), opt('t', 'Above'), opt('n', 'Hidden')] },
        valuePos: { label: 'Number position', type: 'select', value: 'b', options: [opt('b', 'Below'), opt('r', 'Beside')] },
        medium: { label: 'Medium', type: 'select', value: 'none', options: MEDIUM_OPTIONS, description: 'Empty (none) = the medium of a connection that touches it.' },
        mediumColor: { label: 'Medium colour', type: 'color', value: 'var(--info)', description: 'For the medium "A colour of my own".' },
        min: { label: 'Minimum', type: 'number', nullable: true, display: 'input', placeholder: '0' },
        max: { label: 'Maximum', type: 'number', nullable: true, display: 'input', placeholder: '100' },
        showValue: { label: 'Show the number', type: 'boolean', value: true },
        fillColor: { label: 'Liquid colour', type: 'color', description: 'Empty = the symbol\'s own.' },
        idleColor: { label: 'Idle colour', type: 'color', description: 'Empty = the scene\'s.' },
        runningColor: { label: 'Running colour', type: 'color', description: 'Empty = the scene\'s.' },
        warningColor: { label: 'Warning colour', type: 'color', description: 'Empty = the scene\'s.' },
        criticalColor: { label: 'Critical colour', type: 'color', description: 'Empty = the scene\'s.' },
        unit: { label: 'Unit', type: 'text', maxLength: 16, placeholder: 'The card\'s unit', description: 'Written after this symbol\'s numbers.' },
        decimals: { label: 'Decimals', type: 'number', nullable: true, display: 'input', min: 0, max: 6, placeholder: 'The card\'s', description: 'For this symbol\'s numbers.' },
      },
    },
    links: {
      label: 'Connections', type: 'repeater', group: 'links', max: MAX_SCENE_LINKS, advanced: true,
      description: 'From and to are a symbol id (or a thing\'s id) and a side: l, r, t or b, optionally with where along the edge (0 to 1): pump1.r, pump1.t:0.26. An id here starts with a letter or _, so a thing whose id starts with a digit cannot be joined. The route is horizontal and vertical legs with rounded corners.',
      fields: {
        from: { label: 'From', type: 'text', maxLength: 80, required: true, placeholder: 'pump1.r' },
        to: { label: 'To', type: 'text', maxLength: 80, required: true, placeholder: 'tank.b' },
        kind: {
          label: 'Kind', type: 'select', value: 'pipe', required: true,
          options: [opt('pipe', 'Pipe'), opt('hose', 'Hose'), opt('cable', 'Cable'), opt('wire', 'Signal wire'), opt('strip', 'Strip'), opt('line', 'Thin line with arrow'), opt('sld', 'Single-line (electrical)')],
        },
        id: { label: 'State from row', type: 'text', maxLength: 64, placeholder: 'The "from" symbol\'s row' },
        medium: { label: 'Medium', type: 'select', value: 'none', options: MEDIUM_OPTIONS },
        mediumColor: { label: 'Medium colour', type: 'color', value: 'var(--info)', description: 'For the medium "A colour of my own".' },
        mid: { label: 'Middle leg at', type: 'number', nullable: true, display: 'input', placeholder: 'automatic', description: 'The x (or y) of the middle leg of a Z route.' },
        arrows: { label: 'Flow arrow', type: 'boolean', value: false },
      },
    },
    idleColor: colorField('Idle', 'colour', 'var(--text-secondary)'),
    runningColor: colorField('Running', 'colour', 'var(--success)'),
    warningColor: colorField('Warning', 'colour', 'var(--warning)'),
    criticalColor: colorField('Critical', 'colour', 'var(--error)'),
    idColumn: { label: 'Row id column', type: 'data-key', slot: 'points', value: 'id', group: 'data', advanced: true, description: 'Which column of the table names a symbol or connection.' },
    animation: { label: 'Animate running parts', type: 'boolean', value: true, group: 'motion', advanced: true },
    // Version 2: titles, zones and dividers, and the calm look.
    ...since(2, {
    shapes: {
      label: 'Titles and zones', type: 'repeater', group: 'shapes', max: MAX_SCENE_SHAPES,
      description: 'A title, a zone outline or a divider line on the canvas. They carry no reading. x and y are the anchor of a title and the top-left corner of a zone or divider.',
      fields: {
        kind: { label: 'Kind', type: 'select', value: 'text', required: true, options: [opt('text', 'Title or note'), opt('zone', 'Zone outline'), opt('divider', 'Divider line')] },
        text: { label: 'Words', type: 'text', maxLength: 80, description: 'A title or note; a zone\'s name.' },
        x: { label: 'x', type: 'number', display: 'input', value: 0 },
        y: { label: 'y', type: 'number', display: 'input', value: 0 },
        w: { label: 'Width', type: 'number', display: 'input', min: 0, max: 4000, description: 'Zone and divider. A vertical divider has width 0.' },
        h: { label: 'Height', type: 'number', display: 'input', min: 0, max: 4000, description: 'Zone and divider. A horizontal divider has height 0.' },
        size: { label: 'Text size', type: 'select', value: 'm', options: [opt('s', 'Small'), opt('m', 'Medium'), opt('l', 'Large')] },
        align: { label: 'Align', type: 'select', value: 'middle', options: [opt('start', 'Start'), opt('middle', 'Middle'), opt('end', 'End')] },
        tone: { label: 'Tone', type: 'select', value: 'neutral', options: [opt('neutral', 'Neutral'), opt('info', 'Info'), opt('success', 'Success'), opt('warning', 'Warning'), opt('error', 'Error')] },
        dashed: { label: 'Dashed', type: 'boolean', value: true },
      },
    },
    calm: { label: 'Calm look', type: 'boolean', value: false, group: 'colour', description: 'Running parts are drawn in plain ink, not green; only a warning or an alarm shows colour (ISA-101 style).' },
    }),
    ...since(3, {
    rules: {
      label: 'Rules', type: 'repeater', group: 'rules', max: MAX_SCENE_RULES,
      description: 'Make symbols and connections follow the data. A rule names a target, up to two conditions and what to change while they hold. Rules run top to bottom; every rule that matches applies, a later rule wins for the same change, and "Stop" ends the rules for that target.',
      fields: {
        ...ruleConditionFields({
          targetPlaceholder: 'pump1, a connection id or *',
          targetDescription: 'A symbol id, a connection id (its "State from row"), a thing\'s id, * for all of them, or things:* for every thing.',
          ownRow: 'This symbol\'s own row',
          otherRow: 'The id of another symbol or connection whose row is read.',
        }),
        state: { label: 'Then: state', type: 'select', options: [opt('', 'No change'), opt('idle', 'Idle'), opt('running', 'Running'), opt('warning', 'Warning'), opt('critical', 'Critical'), opt('off', 'Off (passive, nothing flowing)')] },
        color: { label: 'Colour', type: 'color', description: 'Colours the symbol: its body takes a tint of it, its outline and lit parts the colour itself.' },
        fillColor: { label: 'Liquid colour', type: 'color' },
        dim: { label: 'Passive look', type: 'select', options: YES_NO },
        blink: { label: 'Blink', type: 'select', options: YES_NO, description: 'Not when the viewer asks for reduced motion or the animation is off.' },
        hidden: { label: 'Hide', type: 'select', options: YES_NO, description: 'Connections that touch a hidden symbol still draw.' },
        label: { label: 'Name', type: 'text', maxLength: MAX_RULE_LABEL, placeholder: 'High: {value}', description: 'Tokens: {value}, {value2}, {condition} (what the condition reads), {label}, {id}, {param:name}.' },
        medium: { label: 'Medium', type: 'select', options: [opt('', 'No change'), ...MEDIUM_OPTIONS] },
        animate: { label: 'Motion', type: 'select', options: [opt('', 'No change'), opt('false', 'Stop it'), opt('true', 'Leave it on')] },
        mode: { label: 'Mode', type: 'select', options: [opt('', 'No change'), opt('auto', 'Automatic'), opt('manual', 'Manual (M badge)'), opt('local', 'Local (L badge)'), opt('maintenance', 'In maintenance (wrench)'), opt('lockout', 'Locked out (padlock)'), opt('simulation', 'Simulated (S badge)')], description: 'A badge in the top right corner. A locked-out symbol does not run its actions.' },
        quality: { label: 'Data quality', type: 'select', options: [opt('', 'No change'), opt('good', 'Good'), opt('stale', 'Stale (clock, dimmed)'), opt('bad', 'Bad or uncertain (?, dimmed)'), opt('offline', 'Lost (cross, faded)')], description: 'Shows a dashed frame and a badge in the top left corner.' },
        speed: { label: 'Speed (% of nominal)', type: 'number', nullable: true, display: 'input', min: 0, max: 400, placeholder: '100', description: 'Fans, pumps, reels and flow run at this share of their drawn pace. 0 = stalled (keeps its colour, stands still).' },
        reverse: { label: 'Direction', type: 'select', options: [opt('', 'No change'), opt('false', 'Forward'), opt('true', 'Reverse')], description: 'Rotation and flow run the other way.' },
        ack: { label: 'Alarm acknowledged', type: 'select', options: [opt('', 'No change'), opt('false', 'No (pulses until someone acknowledges)'), opt('true', 'Yes (steady)')] },
        position: { label: 'Opening (%)', type: 'number', nullable: true, display: 'input', min: 0, max: 100, placeholder: 'Not shown', description: 'A bar along the bottom of a valve, damper, door or blind.' },
        pending: { label: 'Command pending', type: 'select', options: YES_NO, description: 'A spinner in the bottom right corner.' },
        failed: { label: 'Command failed', type: 'select', options: YES_NO, description: 'A red mark in the bottom right corner.' },
        // Version 6 (35.3): rules move, resize, turn and re-skin a symbol or a thing; the kit's engine emits these effects since
        // kui-react 47503e2 (`RULE_PLACEMENT_LIVE`; were it ever false, each field would say it takes effect with a kit update).
        dx: { label: 'Move right by', type: 'number', nullable: true, display: 'input', min: -MAX_SCENE_OFFSET, max: MAX_SCENE_OFFSET, placeholder: '0', ...pending('Scene units; a negative number moves it left.') },
        dy: { label: 'Move down by', type: 'number', nullable: true, display: 'input', min: -MAX_SCENE_OFFSET, max: MAX_SCENE_OFFSET, placeholder: '0', ...pending('Scene units; a negative number moves it up.') },
        scale: { label: 'Size (times its own)', type: 'number', nullable: true, display: 'input', min: 0.2, max: 4, step: 0.05, placeholder: '1', ...pending() },
        turn: { label: 'Turn to', type: 'select', options: [opt('', 'No change'), ...TURN_OPTIONS], ...pending() },
        symbol: { label: 'Draw as', type: 'select', options: [opt('', 'No change'), ...SYMBOL_OPTIONS], ...pending('Another symbol in the same place. A symbol of a piece this workspace does not hold draws a placeholder.') },
        stop: stopField(),
      },
    },
    }),
  }),
  // Version 6 (35.3): things from data. A second table, one row per object, places a symbol per row the way an authored one is
  // placed; rules, connections and clicks reach it by its id.
  ...since(6, {
    thingsIdColumn: { label: 'Thing id column', type: 'data-key', slot: 'things', value: 'id', group: 'things', description: 'Names each thing for rules, connections and clicks. A thing whose id is a symbol\'s or a connection\'s is not drawn.' },
    thingsSymbol: { label: 'One symbol for every thing', type: 'select', value: '', group: 'things', options: [opt('', 'From the symbol column'), ...SYMBOL_OPTIONS] },
    thingsSymbolColumn: { label: 'Symbol column', type: 'data-key', slot: 'things', value: 'symbol', group: 'things', description: 'A symbol key per row (a row without it reads its kind column). An unknown key, or a symbol of a piece this workspace does not hold, draws a placeholder.' },
    thingsXColumn: { label: 'x column', type: 'data-key', slot: 'things', value: 'x', group: 'things' },
    thingsYColumn: { label: 'y column', type: 'data-key', slot: 'things', value: 'y', group: 'things', description: 'A thing is placed by its centre. A row without x or y is not drawn.' },
    thingsTurnColumn: { label: 'Turn column', type: 'data-key', slot: 'things', value: 'turn', group: 'things', advanced: true, description: 'Degrees, snapped to a quarter turn (a row without it reads its heading column).' },
    thingsLabelColumn: { label: 'Name column', type: 'data-key', slot: 'things', value: 'label', group: 'things' },
    thingsUnits: {
      label: 'x and y are in', type: 'select', display: 'segmented', value: 'scene', group: 'things', required: true,
      options: [opt('scene', 'Scene units'), opt('metres', 'Metres')],
    },
    thingsScale: { label: 'Scene units per metre', type: 'number', display: 'input', min: 0.01, max: 1000, value: 50, group: 'things', description: 'For positions in metres.' },
    thingsOriginX: { label: 'Where 0 m is: x', type: 'number', display: 'input', value: 0, group: 'things', advanced: true, description: 'Scene units, for positions in metres.' },
    thingsOriginY: { label: 'Where 0 m is: y', type: 'number', display: 'input', value: 0, group: 'things', advanced: true },
  }),
  // Version 7 (phase 42.5, D42-12): the scene can be a stored diagram. The page's device or asset says which one it shows (a scene binding of
  // kind `diagram`); `diagramId` is this card's own default, drawn for a page without a binding (empty: the diagram inside this card, as before),
  // and `sceneSlot` names which of the subject's scenes the card draws (empty: `main`). While a diagram is drawn its canvas, symbols, connections,
  // zones, rules and the geometry of the things come from it, not from this card; the card keeps the colours, the animation and the table columns.
  ...since(7, {
    // e2e round 4 (B-R4-01): the drawing is picked by its name from the saved drawings (the host renders `remote-select`; a host without the override shows a
    // text field for the id), in the Picture group, for a card whose Picture is its own. It is also the drawing drawn for a page whose device chose none.
    diagramId: {
      label: 'Drawing', type: 'remote-select', maxLength: 36, group: 'picture', showIf: { picture: 'own' },
      endpoint: '/api/dashboard_scada/diagrams?pageSize=100&sort=name:asc', dataKey: 'data', labelKey: 'name', valueKey: 'diagramId', emptyLabel: 'The symbols drawn inside this card',
      description: 'A drawing saved under Process Diagrams. Empty: the symbols drawn inside this card (Edit diagram).',
    },
    // phase 47.3: "Which view" picks a view by its drawing's NAME from the slots route (the card's own device's views, else the ones in use across the tenant, the
    // host fills the subject in); the value stored is the slot the server allocated, never typed or shown. A host without the override shows a text field.
    sceneSlot: {
      label: 'Which view', type: 'remote-select', maxLength: 32, group: 'diagram', advanced: true,
      endpoint: '/api/dashboard/scene-bindings/slots?kind=diagram', dataKey: 'slots', labelKey: 'label', valueKey: 'slot',
      description: 'Which of the device\'s drawings this card draws, by its name. A card that follows the page\'s device lists the drawings in use: the first one, the second one and so on. Empty: the first.',
    },
  }),
  },
  rules: [
    (v: Sparse) => {
      const issues: Array<{ path: string; message: string }> = [];
      const ids = new Set<string>();
      list<SceneElementSetting>(v.elements).forEach((e, i) => {
        if (!isFormKey(e.id)) issues.push({ path: `elements.${i}.id`, message: 'An id starts with a letter or _ and has only letters, digits, . _ -' });
        else if (ids.has(e.id)) issues.push({ path: `elements.${i}.id`, message: 'Ids must be different' });
        else ids.add(e.id);
        if (!isScadaSymbol(e.symbol)) issues.push({ path: `elements.${i}.symbol`, message: 'Choose a symbol' });
      });
      const linkIds = list<SceneLinkSetting>(v.links).map((l) => (typeof l.id === 'string' ? l.id : '')).filter(Boolean);
      // A connection may end on a thing by its id (35.3). Things come from data, so an end that names no authored symbol may
      // be one; the scene counts a connection it cannot join as a problem. Only a connection's own id is refused here: a
      // thing never takes it (`readThings`), so such an end can never join.
      const connectionIds = new Set(linkIds.filter((id) => !ids.has(id)));
      list<SceneLinkSetting>(v.links).forEach((l, i) => {
        for (const end of ['from', 'to'] as const) {
          const port = parsePort(l[end]);
          if (!port) issues.push({ path: `links.${i}.${end}`, message: 'Use a symbol id and a side: l, r, t or b (pump1.r)' });
          else if (connectionIds.has(port.id)) issues.push({ path: `links.${i}.${end}`, message: 'No symbol has this id' });
        }
      });
      issues.push(...sceneRuleIssues(v.rules, ids, linkIds));
      if (typeof v.diagramId === 'string' && v.diagramId !== '' && !DIAGRAM_ID.test(v.diagramId)) issues.push({ path: 'diagramId', message: 'A diagram id looks like 123e4567-e89b-12d3-a456-426614174000' });
      if (typeof v.sceneSlot === 'string' && v.sceneSlot !== '' && !SCENE_SLOT.test(v.sceneSlot)) issues.push({ path: 'sceneSlot', message: 'Choose one of the views in the list' });
      return issues;
    },
  ],
  migrations: [
    { from: 1, to: 2, note: 'Titles and zones on the canvas, single-line connections and a calm look (all new, nothing changes for a saved diagram).' },
    { from: 2, to: 3, note: 'Rules and per-symbol colours, unit and decimals (all new).' },
    { from: 3, to: 4, note: 'Symbol states: mode, data quality, speed, direction, alarm acknowledgement, opening and command badges, as row columns and as rule effects (all new).' },
    { from: 4, to: 5, note: 'Seven symbols that duplicated another one were merged (television, smart plug, smoke detector, shell-and-tube exchanger, emergency shutdown valve, freeze dryer, fermenter); saved diagrams are upgraded to the kept symbol.', ops: [{ op: 'each', key: 'elements', ops: [{ op: 'mapValue', key: 'symbol', map: SYMBOL_RENAMES }] }] },
    { from: 5, to: 6, note: 'Things from data: a second table places a symbol per row (Things group), rules reach them (things:* or an id), and rule fields to move, resize, turn and re-skin a symbol, which take effect with the kit update that follows (all new, nothing changes for a saved diagram).' },
    // Nothing is rewritten: the inline scene stays valid and stays the card's default for a page without a stored diagram (D42-12), so no op runs.
    { from: 6, to: 7, note: 'Stored diagrams: a page\'s device or asset can be bound to a diagram, and a card can name a default one (Stored diagram group); the diagram inside the card stays and is drawn while nothing is bound (all new, nothing changes for a saved diagram).' },
    { from: 7, to: 8, note: 'The Picture choice: a card follows the drawing chosen on its device\'s page, or keeps its own (all new, nothing changes for a saved diagram).' },
    { from: 8, to: 9, note: 'A card\'s own drawing is picked by name from the saved drawings, under Picture (the same stored id; nothing changes for a saved diagram).' },
  ],
};

export const SCADA_SCENE_KIND: BuiltinKindSpec = {
  type: 'scada.scene',
  label: 'Process diagram',
  category: 'Process & SCADA',
  group: 'scada',
  description: 'A whole process diagram on one canvas: symbols placed by coordinates and joined by pipes, hoses, cables and wires that route themselves.',
  icon: 'fas fa-diagram-project',
  defaultW: 12,
  defaultH: 8,
  slots: [
    { key: 'points', label: 'Readings (a row per symbol id)', shape: 'table', required: false },
    // 35.3: one row per object placed from data (id, symbol, x, y, turn, label and the state columns); at most 500 are drawn.
    { key: 'things', label: 'Things (a row per object)', shape: 'table', required: false },
  ],
  template: SCADA_SCENE,
};

/** Every symbol id the scene accepts (for tools that generate scenes). */
export const SCENE_SYMBOL_IDS: readonly string[] = SCADA_SYMBOLS.filter((k) => !!(SCADA_SYMBOL_DEFS[k] as SymbolDef));
