// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-heating.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "heating" sector sample: a family house heated two ways, as one process diagram with its readings, and the board
// built around it (pure data). A combi boiler feeds a single-pipe radiator loop (panel and column radiators, a
// thermostatic valve, a circulator pump, an expansion vessel) and the hot tap; an air-to-water heat pump charges a
// buffer tank that feeds the underfloor manifold; on the roof a solar collector heats the hot water cylinder and a
// thermosiphon heater works alone; in the bathroom a gas water heater and a towel radiator. Flow runs red, return and
// cold feed run blue. The combi boiler is losing water pressure and is close to a lockout.

import type { BoardDocument } from '../settings/board';
import { board, OK, P, scene, WARN, BAD } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });
const HOT = { medium: 'hot' };
const COLD = { medium: 'cold' };
const on = (...ids: string[]): Row[] => ids.map((id) => ({ id, running: true }));
/** Rows merged by id: a later row adds to an earlier one (the scene reads the first row of an id). */
const merge = (...parts: Row[][]): Row[] => {
  const out: Row[] = [];
  for (const r of parts.flat()) {
    const i = out.findIndex((x) => x.id === r.id);
    if (i >= 0) out[i] = { ...out[i], ...r }; else out.push(r);
  }
  return out;
};

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.heating',
  title: 'Home heating',
  settings: {
    width: 1560, height: 840, scale: 0.7, background: 'dots',
    shapes: [
      { kind: 'text', x: 20, y: 34, text: 'Family house · heating and hot water', size: 'l', align: 'start' },
      { kind: 'zone', x: 10, y: 56, w: 320, h: 744, text: 'Living space', tone: 'info' },
      { kind: 'zone', x: 340, y: 56, w: 550, h: 414, text: 'Boiler room', tone: 'warning' },
      { kind: 'zone', x: 340, y: 480, w: 550, h: 320, text: 'Heat pump', tone: 'success' },
      { kind: 'zone', x: 900, y: 56, w: 650, h: 744, text: 'Roof and bathroom', tone: 'neutral' },
      { kind: 'text', x: 660, y: 410, text: 'Low water pressure: lockout risk', size: 's', align: 'start', tone: 'error' },
      { kind: 'text', x: 24, y: 350, text: 'Radiator loop (single pipe)', size: 's', align: 'start' },
      { kind: 'text', x: 24, y: 640, text: 'Underfloor loop', size: 's', align: 'start' },
      { kind: 'text', x: 940, y: 322, text: 'Solar loop', size: 's', align: 'start' },
      { kind: 'text', x: 1238, y: 238, text: 'Hot water cylinder', size: 's', align: 'start' },
      { kind: 'text', x: 1452, y: 238, text: 'Thermosiphon', size: 's', align: 'start' },
    ],
    elements: [
      // radiators under the windows (mirrored: the flow stub is on the right) and the combi boiler
      E('radiator_bedroom', 'hvac.radiator.panel', 70, 150, { mirror: true, labelPos: 't', showValue: false, label: 'Bedroom', min: 20, max: 80, unit: '°C', decimals: 0 }),
      E('radiator_living_room', 'hvac.radiator.panel', 170, 150, { mirror: true, labelPos: 't', showValue: false, label: 'Living room', min: 20, max: 80, unit: '°C', decimals: 0 }),
      E('radiator_hall', 'hvac.radiator.column', 270, 150, { mirror: true, labelPos: 't', showValue: false, label: 'Hall', min: 20, max: 80, unit: '°C', decimals: 0 }),
      E('combi_boiler', 'hvac.boiler.combi', 640, 150, { labelPos: 't', label: 'Combi boiler', unit: '°C', decimals: 0 }),
      // the circuit: a thermostatic valve, the pump, a tee with the expansion vessel, an elbow up to the boiler
      E('valve_radiator', 'hvac.valve.trv', 150, 320, { labelPos: 't', showValue: false, label: 'Radiator valve', min: 0, max: 5, decimals: 0, ...HOT }),
      E('pump_circulation', 'hvac.pump.heating', 390, 320, { labelPos: 't', label: 'Circulator pump', ...HOT }),
      E('tee_expansion', 'pipe.tee', 480, 320, { label: 'Expansion tee', labelPos: 'n', ...HOT }),
      E('vessel_expansion', 'hvac.vessel.expansion', 480, 395, { turn: '180', label: 'Expansion vessel', min: 0, max: 4, unit: ' bar', decimals: 1, ...HOT }),
      E('elbow_return', 'pipe.elbow', 619.7, 320, { label: 'Return elbow', labelPos: 'n', turn: '90', ...HOT }),
      // hot tap and cold feed of the combi
      E('valve_cold_mains', 'valve.ball', 740, 215, { labelPos: 't', label: 'Cold mains', ...COLD }),
      E('valve_hot_tap', 'valve.ball', 830, 275, { labelPos: 't', label: 'Hot tap', ...HOT }),
      // heat pump, buffer tank and underfloor manifold
      E('heat_pump_air', 'hvac.heatpump.air', 700, 640, { label: 'Air-to-water heat pump', unit: '°C', decimals: 0 }),
      E('tank_buffer', 'hvac.tank.buffer', 480, 560, { label: 'Buffer tank', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('manifold_underfloor', 'hvac.manifold.underfloor', 260, 560, { mirror: true, label: 'Underfloor manifold', min: 0, max: 100, unit: '%', decimals: 0 }),
      // roof: collector, cylinder with its valves, the thermosiphon heater
      E('collector_solar', 'hvac.collector.solar', 1000, 160, { labelPos: 't', label: 'Solar collector', min: 0, max: 120, unit: '°C', decimals: 0 }),
      E('cylinder_hot_water', 'hvac.cylinder.dhw', 1190, 260, { label: 'Hot water cylinder', labelPos: 'n', valuePos: 'r', min: 10, max: 70, unit: '°C', decimals: 0 }),
      E('valve_cylinder_hot', 'valve.ball', 1190, 170, { label: 'Cylinder hot valve', turn: '90', labelPos: 'n', ...HOT }),
      E('valve_cylinder_cold', 'valve.ball', 1190, 350, { label: 'Cylinder cold valve', turn: '90', labelPos: 'n', ...COLD }),
      E('heater_thermosiphon', 'hvac.heater.solar.thermosiphon', 1400, 260, { label: 'Thermosiphon heater', labelPos: 'n', valuePos: 'r', min: 10, max: 80, unit: '°C', decimals: 0 }),
      E('valve_thermosiphon_hot', 'valve.ball', 1400, 170, { label: 'Thermosiphon hot valve', turn: '90', labelPos: 'n', ...HOT }),
      E('valve_thermosiphon_cold', 'valve.ball', 1400, 350, { label: 'Thermosiphon cold valve', turn: '90', labelPos: 'n', ...COLD }),
      // bathroom: gas water heater and towel radiator
      E('heater_gas_water', 'hvac.heater.instant', 1190, 480, { labelPos: 't', valuePos: 'r', label: 'Gas water heater', min: 20, max: 60, unit: '°C', decimals: 0 }),
      E('valve_heater_cold_in', 'valve.ball', 1090, 570, { label: 'Cold in', ...COLD }),
      E('valve_heater_hot_out', 'valve.ball', 1290, 600, { label: 'Hot out', ...HOT }),
      E('valve_towel_flow', 'valve.ball', 1130, 740, { labelPos: 't', label: 'Flow valve', ...HOT }),
      E('radiator_towel', 'hvac.heater.towel', 1250, 740, { labelPos: 't', label: 'Towel radiator' }),
      E('valve_towel_return', 'valve.ball', 1370, 740, { labelPos: 't', label: 'Return valve', ...COLD }),
    ],
    links: [
      // radiator loop: boiler flow > hall > living room > bedroom > valve > pump > tee > elbow > boiler return
      L('combi_boiler.b:0.1176', 'radiator_hall.b:0.75', 'pipe', { id: 'c1', mid: 245, ...HOT }),
      L('radiator_hall.b:0.25', 'radiator_living_room.b:0.75', 'pipe', { id: 'c2', mid: 225, ...HOT }),
      L('radiator_living_room.b:0.25', 'radiator_bedroom.b:0.75', 'pipe', { id: 'c3', mid: 225, ...HOT }),
      L('radiator_bedroom.b:0.25', 'valve_radiator.l', 'pipe', { id: 'c4', ...COLD }),
      L('valve_radiator.r', 'pump_circulation.l', 'pipe', { id: 'c5', ...COLD }),
      L('pump_circulation.r', 'tee_expansion.l', 'pipe', { id: 'c6', ...COLD }),
      L('tee_expansion.b', 'vessel_expansion.t', 'pipe', { id: 'c7', ...COLD }),
      L('tee_expansion.r', 'elbow_return.l', 'pipe', { id: 'c8', ...COLD }),
      L('elbow_return.t', 'combi_boiler.b:0.3294', 'pipe', { id: 'c9', ...COLD }),
      // hot tap and cold feed
      L('combi_boiler.b:0.8824', 'valve_cold_mains.l', 'pipe', { id: 'k1', ...COLD }),
      L('combi_boiler.b:0.6706', 'valve_hot_tap.l', 'pipe', { id: 'k2', ...HOT }),
      // heat pump circuit
      L('heat_pump_air.r', 'tank_buffer.r:0.25', 'pipe', { id: 'h1', mid: 790, ...HOT }),
      L('heat_pump_air.l', 'tank_buffer.r:0.75', 'pipe', { id: 'h2', ...COLD }),
      L('tank_buffer.l:0.25', 'manifold_underfloor.r:0.3', 'pipe', { id: 'h3', ...HOT }),
      L('manifold_underfloor.r:0.7', 'tank_buffer.l:0.75', 'pipe', { id: 'h4', ...COLD }),
      // solar loop and the cylinder's taps
      L('collector_solar.r', 'cylinder_hot_water.l:0.32', 'pipe', { id: 's1', mid: 1095, ...HOT }),
      L('cylinder_hot_water.l:0.7', 'collector_solar.l', 'pipe', { id: 's2', mid: 935, ...COLD }),
      L('valve_cylinder_hot.b', 'cylinder_hot_water.t', 'pipe', { id: 's3', ...HOT }),
      L('cylinder_hot_water.b', 'valve_cylinder_cold.t', 'pipe', { id: 's4', ...COLD }),
      L('valve_thermosiphon_hot.b', 'heater_thermosiphon.t', 'pipe', { id: 't1', ...HOT }),
      L('heater_thermosiphon.b', 'valve_thermosiphon_cold.t', 'pipe', { id: 't2', ...COLD }),
      // bathroom
      L('heater_gas_water.b:0.3', 'valve_heater_cold_in.r', 'pipe', { id: 'b1', ...COLD }),
      L('heater_gas_water.b:0.7', 'valve_heater_hot_out.l', 'pipe', { id: 'b2', ...HOT }),
      L('valve_towel_flow.r', 'radiator_towel.l', 'pipe', { id: 'b3', ...HOT }),
      L('radiator_towel.r', 'valve_towel_return.l', 'pipe', { id: 'b4', ...COLD }),
    ],
  },
  rows: merge(
    on('radiator_bedroom', 'radiator_living_room', 'radiator_hall', 'valve_radiator', 'pump_circulation', 'tee_expansion', 'vessel_expansion', 'elbow_return', 'valve_cold_mains', 'valve_hot_tap', 'heat_pump_air', 'tank_buffer', 'manifold_underfloor', 'collector_solar', 'cylinder_hot_water', 'valve_cylinder_hot', 'valve_cylinder_cold', 'heater_thermosiphon', 'valve_thermosiphon_hot', 'valve_thermosiphon_cold', 'heater_gas_water', 'valve_heater_cold_in', 'valve_heater_hot_out', 'valve_towel_flow', 'radiator_towel', 'valve_towel_return'),
    on('combi_boiler', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'k1', 'k2', 'h1', 'h2', 'h3', 'h4', 's1', 's2', 's3', 's4', 't1', 't2', 'b1', 'b2', 'b3', 'b4'),
    [
      { id: 'combi_boiler', value: 58, value2: 0.8, status: 'warning', ack: false },
      { id: 'radiator_bedroom', value: 52 }, { id: 'radiator_living_room', value: 58 }, { id: 'radiator_hall', value: 55 },
      { id: 'valve_radiator', value: 3 },
      { id: 'vessel_expansion', value: 0.8 },
      { id: 'heat_pump_air', value: 38 },
      { id: 'tank_buffer', value: 62 },
      { id: 'manifold_underfloor', value: 65 },
      { id: 'collector_solar', value: 78 },
      { id: 'cylinder_hot_water', value: 54 },
      { id: 'heater_thermosiphon', value: 46 },
      { id: 'heater_gas_water', value: 41 },
    ],
  ),
};

/** The house plant and its zones, with what a householder keeps beside it. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Home heating', [
  scene(SECTOR_SCENE, 9, 10),
  P('boiler', 'state', 'Boiler status', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Combi boiler',
    states: [{ match: 'RUNNING', label: 'Heating', color: OK, icon: 'fas fa-fire-flame-simple', pulse: true }, { match: 'STOPPED', label: 'Lockout', color: BAD, icon: 'fas fa-lock' }, { match: 'IDLE', label: 'Standby', color: WARN, icon: 'fas fa-pause' }],
    showSince: true,
  }),
  P('flow', 'stat.value', 'Flow temperature', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Flow temperature', icon: 'fas fa-temperature-half', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('target', 'control.setpoint', 'Room set point', 9, 6, 3, 4, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Room target', min: 16, max: 26, step: 0.5, $format: { unit: '°C', decimals: 1 },
  }),
  P('heat', 'control.switch', 'Heating', 9, 10, 3, 2, { value: 'sample.pump' }, { label: 'Heating', icon: 'fas fa-fire', stateDisplay: 'pill' }),
  P('water', 'control.switch', 'Hot water', 9, 12, 3, 2, { value: 'sample.pump' }, { label: 'Hot water', icon: 'fas fa-faucet-drip', stateDisplay: 'pill' }),
  P('temps', 'chart.line', 'Temperature', 0, 10, 5, 5, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Heating events', 5, 10, 4, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 4 }),
]);
