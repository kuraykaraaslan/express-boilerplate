// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-turkish.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "turkish" sample: a Turkish home kitchen cut into four zones (tea corner, coffee corner, grill and oven, prep) with
// the small appliances found in such homes, their readings, and the board built around it (pure data). Power is `cable`
// (appliances on power strips; the hand blender's cord leaves at the top, the oven's and the juicer's at the side).

import type { BoardDocument } from '../settings/board';
import type { ScadaScene } from './scada-scenes';
import { BAD, board, OK, P, scene as scenePlacement, WARN } from './scada-board-kit';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });
const T = (x: number, y: number, text: string, extra: Elem = {}): Elem => ({ kind: 'text', x, y, text, ...extra });

/** Rows merged by id: a later row adds to an earlier one. */
const merge = (...parts: Row[][]): Row[] => {
  const out: Row[] = [];
  for (const r of parts.flat()) {
    const i = out.findIndex((x) => x.id === r.id);
    if (i >= 0) out[i] = { ...out[i], ...r }; else out.push(r);
  }
  return out;
};
const on = (...ids: string[]): Row[] => ids.map((id) => ({ id, running: true }));

/** Name above the symbol and the number beside it, for the symbols whose cord leaves at the bottom. */
const TOP: Elem = { labelPos: 't', valuePos: 'r' };
const R = (min: number, max: number, unit: string, decimals = 0): Elem => ({ min, max, unit, decimals });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.turkish',
  title: 'Turkish kitchen',
  settings: {
    width: 1380, height: 900, scale: 1, background: 'dots',
    shapes: [
      T(20, 32, 'Turkish kitchen', { size: 'l', align: 'start' }),
      { kind: 'zone', x: 20, y: 60, w: 560, h: 400, text: 'Tea corner', tone: 'warning' },
      { kind: 'zone', x: 600, y: 60, w: 760, h: 400, text: 'Coffee corner', tone: 'neutral' },
      { kind: 'zone', x: 20, y: 480, w: 660, h: 400, text: 'Grill and oven', tone: 'neutral' },
      { kind: 'zone', x: 700, y: 480, w: 660, h: 400, text: 'Prep', tone: 'info' },
    ],
    elements: [
      // Tea corner: the two-tier maker, the samovar and the jug kettle on one strip
      E('tea_maker', 'kitchen.tea.maker', 100, 175, { label: 'Tea maker', ...TOP, ...R(0, 100, '°C') }),
      E('samovar', 'kitchen.tea.samovar', 240, 175, { label: 'Samovar', ...TOP, ...R(0, 100, '%') }),
      E('water_kettle', 'appliance.kettle', 380, 175, { label: 'Water kettle', ...TOP, ...R(0, 100, '%') }),
      E('power_strip_tea', 'telecom.pdu', 240, 355, { label: 'Power strip' }),
      // Coffee corner
      E('coffee_grinder', 'kitchen.coffee.grinder', 690, 175, { label: 'Coffee grinder', ...TOP }),
      E('turkish_coffee_maker', 'kitchen.coffee.turkish', 850, 175, { label: 'Turkish coffee', ...TOP, ...R(0, 100, '%') }),
      E('water_dispenser', 'kitchen.dispenser.water', 1010, 175, { label: 'Water dispenser', ...TOP, ...R(0, 100, '%') }),
      E('milk_frother', 'kitchen.frother', 1170, 175, { label: 'Milk frother', ...TOP }),
      E('power_strip_coffee', 'telecom.pdu', 930, 355, { label: 'Power strip' }),
      // Grill and oven
      E('toastie_grill', 'kitchen.grill.contact', 100, 575, { label: 'Toastie grill', ...TOP, ...R(0, 250, '°C') }),
      E('steamer', 'kitchen.cooker.steam', 250, 575, { label: 'Steamer', ...TOP, ...R(0, 60, 'min') }),
      E('power_strip_grill', 'telecom.pdu', 330, 775, { label: 'Power strip' }),
      E('mini_oven', 'kitchen.oven.mini', 510, 775, { label: 'Mini oven', ...R(0, 250, '°C') }),
      // Prep: the hand blender's cord goes up to the strip, the juicer stands mirrored on the other side
      E('yogurt_maker', 'kitchen.yogurt.maker', 770, 575, { label: 'Yogurt maker', ...TOP, ...R(0, 100, '%') }),
      E('power_strip_prep', 'telecom.pdu', 930, 640, { label: 'Power strip', labelPos: 'n' }),
      E('hand_blender', 'kitchen.mixer.hand', 930, 790, { label: 'Hand blender', ...R(0, 100, '%') }),
      E('juicer', 'kitchen.juicer', 1130, 640, { label: 'Juicer', mirror: true, ...R(0, 100, '%') }),
    ],
    links: [
      L('tea_maker.b', 'power_strip_tea.t', 'cable', { id: 'pw1' }),
      L('samovar.b', 'power_strip_tea.t', 'cable', { id: 'pw1' }),
      L('water_kettle.b', 'power_strip_tea.t', 'cable', { id: 'pw1' }),
      L('coffee_grinder.b', 'power_strip_coffee.t', 'cable', { id: 'pw2' }),
      L('turkish_coffee_maker.b', 'power_strip_coffee.t', 'cable', { id: 'pw2' }),
      L('water_dispenser.b', 'power_strip_coffee.t', 'cable', { id: 'pw2' }),
      L('milk_frother.b', 'power_strip_coffee.t', 'cable', { id: 'pw2' }),
      L('toastie_grill.b', 'power_strip_grill.t', 'cable', { id: 'pw3' }),
      L('steamer.b', 'power_strip_grill.t', 'cable', { id: 'pw3' }),
      L('power_strip_grill.r', 'mini_oven.l', 'cable', { id: 'pw3' }),
      L('yogurt_maker.b', 'power_strip_prep.l', 'cable', { id: 'pw4' }),
      L('hand_blender.t', 'power_strip_prep.b', 'cable', { id: 'pw4' }),
      L('power_strip_prep.r', 'juicer.l', 'cable', { id: 'pw4' }),
    ],
  },
  rows: merge(
    on('tea_maker', 'samovar', 'power_strip_tea', 'turkish_coffee_maker', 'water_dispenser', 'power_strip_coffee', 'toastie_grill', 'power_strip_grill', 'yogurt_maker', 'power_strip_prep'),
    on('pw1', 'pw2', 'pw3', 'pw4'),
    [
      // The tea is brewing, the samovar runs low, the grill is heating, the yogurt is setting.
      { id: 'tea_maker', running: true, value: 96, label: 'Tea · brewing' },
      { id: 'samovar', running: true, value: 9, status: 'warning', label: 'Samovar · low' },
      { id: 'water_kettle', running: false, value: 55 },
      { id: 'coffee_grinder', running: false },
      { id: 'turkish_coffee_maker', running: true, value: 70 },
      { id: 'water_dispenser', running: true, value: 64 },
      { id: 'milk_frother', running: false },
      { id: 'toastie_grill', running: true, value: 190, label: 'Grill · heating' },
      { id: 'steamer', running: false, value: 20 },
      { id: 'mini_oven', running: false, value: 20 },
      { id: 'yogurt_maker', running: true, value: 45, label: 'Yogurt · setting' },
      { id: 'hand_blender', running: false, value: 60 },
      { id: 'juicer', running: false, value: 30 },
    ],
  ),
};

/** The board: the kitchen beside the controls: tea and grill switches, a tea set point, a "Put the tea on" button, the energy used and its trend. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Turkish kitchen', [
  scenePlacement(SECTOR_SCENE, 9, 14),
  P('status', 'state', 'Tea maker', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Tea maker',
    states: [
      { match: 'RUNNING', label: 'Brewing', color: OK, icon: 'fas fa-mug-hot', pulse: true },
      { match: 'STOPPED', label: 'Off', color: BAD, icon: 'fas fa-power-off' },
      { match: 'IDLE', label: 'Ready', color: WARN, icon: 'fas fa-mug-saucer' },
    ],
    showSince: true,
  }),
  P('tea', 'control.button', 'Put the tea on', 9, 3, 3, 2, {}, { label: 'Put the tea on', icon: 'fas fa-mug-hot', fullWidth: true }),
  P('teamaker', 'control.switch', 'Tea maker power', 9, 5, 3, 2, { value: 'sample.pump' }, { label: 'Tea maker', icon: 'fas fa-plug', stateDisplay: 'pill' }),
  P('grill', 'control.switch', 'Toastie grill', 9, 7, 3, 2, { value: 'sample.pump' }, { label: 'Toastie grill', icon: 'fas fa-bread-slice', stateDisplay: 'pill' }),
  P('samovar', 'control.switch', 'Samovar', 9, 9, 3, 2, { value: 'sample.pump' }, { label: 'Samovar', icon: 'fas fa-fire-burner', stateDisplay: 'pill' }),
  P('water', 'control.setpoint', 'Tea water temperature', 9, 11, 3, 3, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Tea water', min: 70, max: 100, step: 1, $format: { unit: '°C', decimals: 0 },
  }),
  P('energy', 'stat.value', 'Energy today', 0, 14, 3, 3, { value: 'sample.cpu', compare: 'sample.temperature.yesterday' }, {
    label: 'Kitchen energy today', icon: 'fas fa-bolt', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: 'Wh', decimals: 0 },
  }),
  P('trend', 'chart.line', 'Kitchen power', 3, 14, 9, 4, { series: 'sample.power' }, { legendValues: ['latest', 'avg'], $format: { unit: 'W', decimals: 0 } }),
]);
