// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-kitchen.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "kitchen" sample: a kitchen counter cut into four zones (coffee corner, cooking, prep, charging station) with the
// small appliances and gadgets in them, their readings, and the board built around it (pure data). Power is `cable`
// (appliances on power strips), the scale talks to a hub over a `wire`. Mirrored appliances put their cord on the other side.

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

/** A reading with a scale and a unit, shown under the symbol. */
/** Name above the symbol and the number beside it, for the symbols whose cord leaves at the bottom. */
const TOP: Elem = { labelPos: 't', valuePos: 'r' };

const R = (min: number, max: number, unit: string, decimals = 0): Elem => ({ min, max, unit, decimals });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.kitchen',
  title: 'Kitchen and gadgets',
  settings: {
    width: 1380, height: 900, scale: 1, background: 'dots',
    shapes: [
      T(20, 32, 'Kitchen and gadgets', { size: 'l', align: 'start' }),
      { kind: 'zone', x: 20, y: 60, w: 660, h: 400, text: 'Coffee corner', tone: 'warning' },
      { kind: 'zone', x: 700, y: 60, w: 660, h: 400, text: 'Cooking', tone: 'neutral' },
      { kind: 'zone', x: 20, y: 480, w: 660, h: 400, text: 'Prep', tone: 'info' },
      { kind: 'zone', x: 700, y: 480, w: 660, h: 400, text: 'Charging station', tone: 'neutral' },
    ],
    elements: [
      // Coffee corner: the drink makers on the bench with their cords down to the strip; the machines with a side cord beside it
      E('burr_grinder', 'kitchen.coffee.grinder', 90, 175, { label: 'Burr grinder', ...TOP }),
      E('kettle_gooseneck', 'kitchen.kettle.gooseneck', 230, 175, { label: 'Gooseneck kettle', ...TOP, ...R(0, 100, '°C') }),
      E('milk_frother', 'kitchen.frother', 370, 175, { label: 'Milk frother', ...TOP }),
      E('water_dispenser', 'kitchen.dispenser.water', 510, 175, { label: 'Water dispenser', ...TOP, ...R(0, 100, '%') }),
      E('espresso_machine', 'kitchen.espresso', 130, 355, { label: 'Espresso machine', ...R(0, 130, '°C') }),
      E('power_strip_coffee', 'telecom.pdu', 330, 355, { label: 'Power strip' }),
      E('capsule_machine', 'kitchen.capsule', 520, 355, { label: 'Capsule machine', ...R(0, 100, '%') }),
      // Cooking
      E('waffle_maker', 'kitchen.waffle', 770, 175, { label: 'Waffle maker', ...TOP }),
      E('sous_vide', 'kitchen.sousvide', 910, 175, { label: 'Sous-vide', ...TOP, ...R(0, 100, '°C', 1) }),
      E('cooker_hood', 'kitchen.hood', 1100, 175, { label: 'Cooker hood', ...R(0, 3, '') }),
      E('toaster', 'kitchen.toaster', 1240, 175, { label: 'Toaster', ...R(0, 180, 's') }),
      E('air_fryer', 'kitchen.airfryer', 790, 355, { label: 'Air fryer' }),
      E('power_strip_cooking', 'telecom.pdu', 970, 355, { label: 'Power strip' }),
      E('pressure_cooker', 'kitchen.cooker.pressure', 1150, 355, { label: 'Pressure cooker', ...R(0, 100, 'kPa') }),
      // Prep
      E('kitchen_scale', 'kitchen.scale', 130, 595, { label: 'Kitchen scale', ...TOP }),
      E('blender', 'kitchen.blender', 270, 595, { label: 'Blender', ...TOP, ...R(0, 100, '%') }),
      E('juicer', 'kitchen.juicer', 420, 595, { label: 'Juicer', ...R(0, 100, '%') }),
      E('bread_maker', 'kitchen.breadmaker', 570, 595, { label: 'Bread maker', ...R(0, 100, '%') }),
      E('smart_plug_hub', 'telecom.access.point', 130, 795, { label: 'Smart-plug hub' }),
      E('stand_mixer', 'kitchen.mixer.stand', 290, 795, { label: 'Stand mixer', mirror: true }),
      E('power_strip_prep', 'telecom.pdu', 430, 795, { label: 'Power strip' }),
      E('toaster_oven', 'kitchen.oven.toaster', 570, 795, { label: 'Toaster oven', ...R(0, 250, '°C') }),
      // Charging station
      E('phone', 'gadget.phone', 770, 595, { label: 'Phone', ...TOP, ...R(0, 100, '%') }),
      E('tablet', 'gadget.tablet', 900, 595, { label: 'Tablet', ...TOP, ...R(0, 100, '%') }),
      E('earbuds_case', 'gadget.earbuds', 1030, 595, { label: 'Earbuds case', ...TOP, ...R(0, 100, '%') }),
      E('headphones', 'gadget.headphones', 1160, 595, { label: 'Headphones', ...TOP, ...R(0, 100, '%') }),
      E('camera', 'gadget.camera', 1290, 595, { label: 'Camera', ...TOP, ...R(0, 100, '%') }),
      E('ebike_battery', 'gadget.ebike.charger', 790, 795, { label: 'E-bike battery', mirror: true, ...R(0, 100, '%') }),
      E('power_strip_charging', 'telecom.pdu', 970, 795, { label: 'Power strip' }),
      E('drone', 'gadget.drone', 1130, 795, { label: 'Drone', ...R(0, 100, '%') }),
      E('smartwatch', 'gadget.watch', 1270, 795, { label: 'Smartwatch', ...R(40, 200, 'bpm') }),
    ],
    links: [
      L('burr_grinder.b', 'power_strip_coffee.t', 'cable', { id: 'pw1' }),
      L('kettle_gooseneck.b', 'power_strip_coffee.t', 'cable', { id: 'pw1' }),
      L('milk_frother.b', 'power_strip_coffee.t', 'cable', { id: 'pw1' }),
      L('water_dispenser.b', 'power_strip_coffee.t', 'cable', { id: 'pw1' }),
      L('espresso_machine.r', 'power_strip_coffee.l', 'cable', { id: 'pw1' }),
      L('power_strip_coffee.r', 'capsule_machine.l', 'cable', { id: 'pw1' }),
      L('waffle_maker.b', 'power_strip_cooking.t', 'cable', { id: 'pw2' }),
      L('sous_vide.b', 'power_strip_cooking.t', 'cable', { id: 'pw2' }),
      L('air_fryer.r', 'power_strip_cooking.l', 'cable', { id: 'pw2' }),
      L('power_strip_cooking.r', 'pressure_cooker.l', 'cable', { id: 'pw2' }),
      L('blender.b', 'power_strip_prep.t', 'cable', { id: 'pw3' }),
      L('stand_mixer.r', 'power_strip_prep.l', 'cable', { id: 'pw3' }),
      L('power_strip_prep.r', 'toaster_oven.l', 'cable', { id: 'pw3' }),
      L('kitchen_scale.b', 'smart_plug_hub.t', 'wire', { id: 'zb' }),
      L('phone.b', 'power_strip_charging.t', 'cable', { id: 'pw4' }),
      L('tablet.b', 'power_strip_charging.t', 'cable', { id: 'pw4' }),
      L('earbuds_case.b', 'power_strip_charging.t', 'cable', { id: 'pw4' }),
      L('headphones.b', 'power_strip_charging.t', 'cable', { id: 'pw4' }),
      L('camera.b', 'power_strip_charging.t', 'cable', { id: 'pw4' }),
      L('ebike_battery.r', 'power_strip_charging.l', 'cable', { id: 'pw4' }),
          ],
  },
  rows: merge(
    on('burr_grinder', 'power_strip_coffee', 'espresso_machine', 'capsule_machine', 'power_strip_cooking', 'air_fryer', 'waffle_maker', 'cooker_hood', 'power_strip_prep', 'stand_mixer', 'smart_plug_hub', 'phone', 'power_strip_charging', 'smartwatch', 'ebike_battery'),
    on('pw1', 'pw2', 'pw3', 'pw4', 'zb'),
    [
      // The espresso machine is brewing, the air fryer is heating, the water tank runs low, the phone charges.
      { id: 'espresso_machine', running: true, value: 93, label: 'Espresso machine · brewing' },
      { id: 'capsule_machine', running: true, value: 64 },
      { id: 'air_fryer', running: true, value: 180, label: 'Air fryer · 180 °C' },
      { id: 'water_dispenser', running: true, value: 12, status: 'warning', label: 'Water dispenser · tank low' },
      { id: 'kettle_gooseneck', running: false, value: 22 },
      { id: 'sous_vide', running: true, value: 56.5 },
      { id: 'cooker_hood', running: true, value: 2 },
      { id: 'pressure_cooker', running: true, value: 55 },
      { id: 'blender', running: false, value: 0 },
      { id: 'kitchen_scale', running: true, value: 1250 },
      { id: 'juicer', running: false, value: 40 },
      { id: 'bread_maker', running: true, value: 55 },
      { id: 'toaster_oven', running: false, value: 20 },
      { id: 'phone', running: true, value: 64, label: 'Phone · charging' },
      { id: 'tablet', running: false, value: 88 },
      { id: 'earbuds_case', running: true, value: 40 },
      { id: 'headphones', running: false, value: 71 },
      { id: 'camera', running: false, value: 92 },
      { id: 'ebike_battery', running: true, value: 58 },
      { id: 'drone', running: false, value: 100 },
      { id: 'smartwatch', running: true, value: 72 },
    ],
  ),
};

/** The board: the kitchen with the espresso, air fryer and tank beside the controls: three switches, a set point, a brew button, the energy and its trend. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Kitchen and gadgets', [
  scenePlacement(SECTOR_SCENE, 9, 14),
  P('status', 'state', 'Coffee machine', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Espresso machine',
    states: [
      { match: 'RUNNING', label: 'Brewing', color: OK, icon: 'fas fa-mug-hot', pulse: true },
      { match: 'STOPPED', label: 'Off', color: BAD, icon: 'fas fa-power-off' },
      { match: 'IDLE', label: 'Ready', color: WARN, icon: 'fas fa-mug-saucer' },
    ],
    showSince: true,
  }),
  P('brew', 'control.button', 'Brew a coffee', 9, 3, 3, 2, {}, { label: 'Brew a coffee', icon: 'fas fa-mug-hot', fullWidth: true }),
  P('power', 'control.switch', 'Coffee machine power', 9, 5, 3, 2, { value: 'sample.pump' }, { label: 'Coffee machine', icon: 'fas fa-plug', stateDisplay: 'pill' }),
  P('kettle', 'control.switch', 'Kettle', 9, 7, 3, 2, { value: 'sample.pump' }, { label: 'Kettle', icon: 'fas fa-fire-burner', stateDisplay: 'pill' }),
  P('hood', 'control.switch', 'Cooker hood', 9, 9, 3, 2, { value: 'sample.pump' }, { label: 'Cooker hood', icon: 'fas fa-fan', stateDisplay: 'pill' }),
  P('airfryer', 'control.setpoint', 'Air fryer temperature', 9, 11, 3, 3, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Air fryer', min: 80, max: 200, step: 5, $format: { unit: '°C', decimals: 0 },
  }),
  P('energy', 'stat.value', 'Energy today', 0, 14, 3, 3, { value: 'sample.cpu', compare: 'sample.temperature.yesterday' }, {
    label: 'Kitchen energy today', icon: 'fas fa-bolt', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: 'Wh', decimals: 0 },
  }),
  P('trend', 'chart.line', 'Kitchen power', 3, 14, 9, 4, { series: 'sample.power' }, { legendValues: ['latest', 'avg'], $format: { unit: 'W', decimals: 0 } }),
]);
