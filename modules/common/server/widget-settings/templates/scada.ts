// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/templates/scada.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
import { colorField, opt, rangesFields, since } from '../settings/packs';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';
import { SYMBOL_RENAMES, RUN_SYMBOLS, SCADA_SYMBOLS, SCADA_SYMBOL_DEFS, SCALED_SYMBOLS, VALUE_SYMBOLS, type SymbolDef } from '../views/scada-logic';

const FAMILY_ORDER = [
  'process', 'fluid', 'mech', 'safety', 'water', 'network', 'wastewater', 'oil', 'energy', 'sld', 'hvac', 'isa', 'instrument', 'telecom', 'food', 'factory', 'mes', 'textile', 'plastic', 'metal', 'cement', 'wood', 'mining', 'agri', 'city', 'home', 'appliance', 'kitchen', 'gadget', 'pharma', 'paper', 'steel', 'storage', 'gasnet', 'hydro', 'building', 'logistics', 'watergas', 'access', 'line', 'connection',
] as const;
const LEVEL = ['tank.vertical', 'tank.short', 'tank.open', 'reservoir.ground'];

/** The symbols in the picker's order: by family, in registry order within it. */
export const SYMBOL_OPTIONS = FAMILY_ORDER.flatMap((fam) => SCADA_SYMBOLS.filter((k) => (SCADA_SYMBOL_DEFS[k] as SymbolDef).family === fam))
  .map((k) => opt(k, (SCADA_SYMBOL_DEFS[k] as SymbolDef).label, `scada-${k}`));

export const MEDIUM_OPTIONS = [
  opt('none', 'The state decides'), opt('cold', 'Cold (blue)'), opt('hot', 'Hot (red)'), opt('water', 'Water (primary)'), opt('custom', 'A colour of my own'),
];

/**
 * `scada.symbol`: one process symbol (a tank, a pump, a valve, a meter, a pipe, a hose, a cable, a turbine, a reel …)
 * drawn from what the source says: a level, a running flag and a warning / critical status. It never decides a
 * threshold itself.
 */
export const SCADA_SYMBOL: SettingsTemplate = {
  id: 'builtin:scada.symbol',
  version: 2,
  namespace: '',
  label: 'Process symbol',
  format: true,
  exportable: false,
  formatDefaults: { decimals: 1 },
  cardDefaults: { padding: 8, staleDisplay: 'dim' },
  rules: [
    (v) => typeof v.min === 'number' && typeof v.max === 'number' && v.min >= v.max
      ? [{ path: 'max', message: 'Maximum must be greater than minimum' }]
      : [],
  ],
  groups: [
    { id: 'symbol', label: 'Symbol', tab: 'Display', since: 1 },
    { id: 'scale', label: 'Scale', tab: 'Display', since: 1 },
    { id: 'label', label: 'Label and value', tab: 'Display', since: 1 },
    { id: 'colour', label: 'Colours', tab: 'Display', since: 1 },
    { id: 'medium', label: 'What flows', tab: 'Display', since: 1 },
    { id: 'bands', label: 'Dial bands', tab: 'Display', since: 1 },
    { id: 'motion', label: 'Animation', tab: 'Display', since: 1 },
  ],
  fields: since(1, {
    symbol: { label: 'Symbol', type: 'select', display: 'cards', value: 'tank.vertical', group: 'symbol', required: true, options: SYMBOL_OPTIONS },
    orientation: {
      label: 'Turn', type: 'select', display: 'segmented', value: '0', group: 'symbol', required: true,
      options: [opt('0', '0°'), opt('90', '90°'), opt('180', '180°'), opt('270', '270°')],
      description: 'Clockwise. An elbow turned through the four steps gives its four corners.',
    },
    mirror: { label: 'Flip left to right', type: 'boolean', value: false, group: 'symbol', description: 'A pump or a reel facing the other way.' },
    length: {
      label: 'Length', type: 'select', display: 'segmented', value: '1', group: 'symbol', required: true, showIf: { symbol: RUN_SYMBOLS },
      options: [opt('1', '1 cell'), opt('2', '2 cells'), opt('3', '3 cells')],
      description: 'Size the card to match: connections are drawn at the same thickness, so neighbours join.',
    },
    maxSize: { label: 'Largest size (px)', type: 'number', nullable: true, display: 'input', min: 16, max: 2000, group: 'symbol', advanced: true, description: 'Empty = as large as the card.' },
    min: { label: 'Minimum', type: 'number', display: 'input', value: 0, group: 'scale', showIf: { symbol: SCALED_SYMBOLS } },
    max: { label: 'Maximum', type: 'number', display: 'input', value: 100, group: 'scale', showIf: { symbol: SCALED_SYMBOLS }, description: 'Used when no value is chosen for Capacity (scale maximum) on the Data tab (tanks).' },
    ticks: { label: 'Level marks', type: 'boolean', value: true, group: 'scale', showIf: { symbol: LEVEL } },
    label: { label: 'Label', type: 'text', maxLength: 80, placeholder: 'Pump 2', group: 'label', description: 'A value chosen for Label on the Data tab wins.' },
    showLabel: { label: 'Show the label', type: 'boolean', value: true, group: 'label' },
    showValue: { label: 'Show the number', type: 'boolean', value: true, group: 'label', showIf: { symbol: VALUE_SYMBOLS } },
    rowLabel1: { label: 'First row name', type: 'text', maxLength: 12, placeholder: 'T1', group: 'label', showIf: { symbol: 'meter.energy' } },
    rowLabel2: { label: 'Second row name', type: 'text', maxLength: 12, placeholder: 'T2', group: 'label', showIf: { symbol: 'meter.energy' } },
    fillColor: colorField('Liquid colour', 'colour', 'var(--info)', { showIf: { symbol: [...LEVEL, 'tower.water', 'well.bore', 'basin.clarifier', 'tank.scale', 'sensor.level', 'coater', 'degasser'] } }),
    idleColor: colorField('Idle', 'colour', 'var(--text-secondary)'),
    runningColor: colorField('Running', 'colour', 'var(--success)'),
    warningColor: colorField('Warning', 'colour', 'var(--warning)'),
    criticalColor: colorField('Critical', 'colour', 'var(--error)'),
    medium: { label: 'Medium', type: 'select', value: 'none', group: 'medium', required: true, options: MEDIUM_OPTIONS, description: 'The colour of what runs through a pipe, hose, cable or wire, a coater pan, a spray.' },
    mediumColor: colorField('Medium colour', 'medium', 'var(--info)', { showIf: { medium: 'custom' } }),
    arrows: { label: 'Flow arrow', type: 'boolean', value: false, group: 'medium', description: 'An arrowhead on straight pipes and wires.' },
    ...rangesFields('Coloured bands on the dial, and the colour a battery or signal indicator fills with.', 'bands'),
    animation: { label: 'Animate running parts', type: 'boolean', value: true, group: 'motion', advanced: true, description: 'Flowing pipes, turning pumps and fans, moving strip. A viewer who asks for reduced motion sees them still.' },
  }),
  migrations: [
    { from: 1, to: 2, note: 'Seven symbols that duplicated another one were merged (television, smart plug, smoke detector, shell-and-tube exchanger, emergency shutdown valve, freeze dryer, fermenter); a saved symbol is upgraded to the kept one.', ops: [{ op: 'mapValue', key: 'symbol', map: SYMBOL_RENAMES }] },
  ],
};

// The bands only show on a dial and on the indicators.
for (const k of ['ranges', 'rangeEdges'] as const) SCADA_SYMBOL.fields[k] = { ...SCADA_SYMBOL.fields[k], showIf: { symbol: ['meter.pressure', 'indicator.battery', 'indicator.signal'] } };

export const SCADA_SYMBOL_KIND: BuiltinKindSpec = {
  type: 'scada.symbol',
  label: 'Process symbol',
  category: 'Process & SCADA',
  group: 'scada',
  description: 'A tank, pump, valve, meter, pipe, hose, cable, turbine, reel or oven drawn from a level, a running flag and a warning or critical status.',
  icon: 'fas fa-industry',
  defaultW: 3,
  defaultH: 3,
  slots: [
    { key: 'value', label: 'Level / flow / pressure / reading', shape: 'scalar', required: false, anyOf: 'symbol' },
    { key: 'value2', label: 'Second reading (two-row meter)', shape: 'scalar', required: false },
    { key: 'capacity', label: 'Capacity (scale maximum)', shape: 'scalar', required: false },
    { key: 'running', label: 'Running / open / closed / flowing', shape: 'scalar', required: false, anyOf: 'symbol' },
    { key: 'status', label: 'Status (none, warning or critical; 0, 1, 2; true = critical)', shape: 'scalar', required: false, anyOf: 'symbol' },
    { key: 'label', label: 'Label', shape: 'scalar', required: false },
  ],
  template: SCADA_SYMBOL,
};
