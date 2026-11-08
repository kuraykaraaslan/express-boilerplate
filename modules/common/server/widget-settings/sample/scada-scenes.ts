// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-scenes.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// Five process diagrams for the scada.scene widget, each with the readings that animate it (pure data). They are the
// SCADA boards of the widget gallery: a pool and filtration plant, a hybrid energy system, a coil coating line, a city
// water network and a drilling rig. The scene settings place symbols by coordinates and join them with connections that
// route themselves; the readings are one table per diagram, a row per symbol id.

import type { SlotData } from '../kind';
import { SECTOR_SCENES } from './scada-sector-all';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

export interface ScadaScene {
  /** The sample source that holds the readings. */
  source: string;
  title: string;
  settings: Record<string, unknown>;
  rows: Row[];
}

const table = (rows: Row[], now: number): SlotData => ({
  shape: 'table',
  fetchedAt: new Date(now).toISOString(),
  columns: [
    { key: 'id', label: 'Symbol', type: 'text' }, { key: 'value', label: 'Reading', type: 'number' }, { key: 'value2', label: 'Second reading', type: 'number' },
    { key: 'running', label: 'Running', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'label', label: 'Name', type: 'text' },
  ],
  rows,
});

const on = (...ids: string[]): Row[] => ids.map((id) => ({ id, running: true }));

/** Rows merged by id: a later row adds to an earlier one. */
const merge = (...parts: Row[][]): Row[] => {
  const out: Row[] = [];
  for (const r of parts.flat()) {
    const i = out.findIndex((x) => x.id === r.id);
    if (i >= 0) out[i] = { ...out[i], ...r }; else out.push(r);
  }
  return out;
};

// ─── 1. A pool and its filtration plant ──────────────────────────────────────
// x and y are the centres of the symbols; the main line runs along y = 360.

export const POOL_SCENE: ScadaScene = {
  source: 'sample.scada.pool',
  title: 'Pool plant',
  settings: {
    width: 1240, height: 640, scale: 0.7, background: 'dots',
    elements: [
      // the units travel into the pool plant's device contract (its profile's schema), so a picker reads "Pool · value (%)" and the equipment panel
      // "77.9 %", never a bare number (e2e round 3, M-R3-10, m-R3-15)
      E('pool', 'tank.open', 640, 130, { scale: 2.4, label: 'Pool', unit: '%' }),
      E('valve_supply', 'valve.ball', 60, 360, { label: 'Supply valve', labelPos: 'n' }),
      E('tee_supply', 'pipe.tee', 150, 360, { label: 'Supply tee', labelPos: 'n' }),
      E('strainer', 'strainer', 245, 360, { label: 'Strainer' }),
      E('pump_circulation', 'pump.volute', 345, 360, { label: 'Circulation pump' }),
      E('sand_filter', 'filter.sand', 490, 360, { scale: 1.4, label: 'Sand filter' }),
      E('meter_flow', 'meter.flow', 640, 360, { label: 'Flow meter', labelPos: 'n', unit: 'm³/h' }),
      E('tee_return', 'pipe.tee', 740, 360, { label: 'Return tee', labelPos: 'n', turn: '180' }),
      E('valve_solenoid', 'valve.solenoid', 835, 360, { label: 'Solenoid valve' }),
      E('heat_pump', 'heat.pump', 990, 360, { scale: 1.3, label: 'Heat pump' }),
      E('valve_drain', 'valve.wheel', 150, 480, { turn: '90', label: 'Drain valve' }),
      E('drain', 'drain', 270, 560, { label: 'Drain' }),
      E('sensor_pressure', 'sensor.pressure', 640, 490, { turn: '180', label: 'Pressure', unit: 'bar' }),
    ],
    links: [
      L('valve_supply.r', 'tee_supply.l', 'pipe', { medium: 'cold' }),
      L('tee_supply.r', 'strainer.l', 'pipe', { medium: 'cold' }),
      L('strainer.r', 'pump_circulation.l', 'pipe', { medium: 'cold' }),
      L('pump_circulation.r', 'sand_filter.l', 'pipe', { medium: 'cold', arrows: true }),
      L('sand_filter.r', 'meter_flow.l', 'pipe', { medium: 'cold' }),
      L('meter_flow.r', 'tee_return.l', 'pipe', { medium: 'cold' }),
      L('tee_return.t', 'pool.b:0.8', 'pipe', { medium: 'cold', arrows: true }),
      L('tee_return.r', 'valve_solenoid.l', 'pipe', { medium: 'cold' }),
      L('valve_solenoid.r', 'heat_pump.l', 'hose', { medium: 'hot' }),
      L('heat_pump.t', 'pool.r:0.7', 'hose', { medium: 'hot' }),
      L('tee_supply.b', 'valve_drain.t', 'pipe', { medium: 'cold' }),
      L('valve_drain.b', 'drain.l', 'pipe', { medium: 'cold' }),
      L('meter_flow.b', 'sensor_pressure.t', 'pipe', { medium: 'cold' }),
    ],
  },
  rows: merge(
    on('valve_supply', 'strainer', 'pump_circulation', 'sand_filter', 'meter_flow', 'tee_supply', 'tee_return', 'valve_solenoid', 'heat_pump', 'sensor_pressure'),
    [{ id: 'pool', value: 72, label: 'Pool · 55 000 L' }, { id: 'meter_flow', value: 198 }, { id: 'valve_drain', running: false }, { id: 'drain', running: false }],
  ),
};

// ─── 2. A hybrid energy system ───────────────────────────────────────────────

export const ENERGY_SCENE: ScadaScene = {
  source: 'sample.scada.energy',
  title: 'Hybrid energy',
  settings: {
    width: 1240, height: 640, scale: 0.62, background: 'dots',
    elements: [
      E('solar_panels', 'solar.panel', 110, 85, { scale: 1.5, label: 'Solar panels' }),
      E('breaker_solar', 'breaker', 320, 85, { label: 'Solar breaker', scale: 1.2, labelPos: 'n' }),
      E('inverter_charger', 'inverter', 600, 110, { scale: 2.4, label: 'Inverter / charger', labelPos: 't' }),
      E('wind_turbine', 'wind.turbine', 110, 290, { scale: 1.7, label: 'Wind turbine' }),
      E('batteries', 'battery.bank', 110, 500, { scale: 1.3, label: 'Batteries', max: 100 }),
      E('transformer', 'transformer', 720, 470, { scale: 1.4, label: 'Power transformer' }),
      E('meter_energy', 'meter.energy', 860, 470, { scale: 1.2, label: 'Meter' }),
      E('breaker_generator', 'breaker', 970, 470, { label: 'Generator breaker', scale: 1.2, labelPos: 'n' }),
      E('generator', 'generator', 1110, 470, { scale: 1.5, label: 'Generator' }),
      E('consumption', 'building', 1100, 160, { scale: 1.5, label: 'Consumption' }),
    ],
    links: [
      L('solar_panels.r', 'breaker_solar.l', 'cable', { id: 'solar_panels' }),
      L('breaker_solar.r', 'inverter_charger.l', 'cable', { id: 'solar_panels' }),
      L('wind_turbine.r', 'inverter_charger.b:0.12', 'cable', { id: 'wind_turbine' }),
      L('batteries.r', 'inverter_charger.b:0.32', 'cable', { id: 'batteries' }),
      L('inverter_charger.b:0.55', 'transformer.t', 'cable', { id: 'inverter_charger', mid: 350 }),
      L('transformer.r', 'meter_energy.l', 'cable', { id: 'inverter_charger' }),
      L('meter_energy.r', 'breaker_generator.l', 'cable', { id: 'inverter_charger' }),
      L('breaker_generator.r', 'generator.l', 'cable', { id: 'generator' }),
      L('generator.t', 'inverter_charger.b:0.85', 'cable', { id: 'generator', mid: 250 }),
      L('inverter_charger.r', 'consumption.l', 'cable', { id: 'inverter_charger' }),
    ],
  },
  rows: [
    { id: 'solar_panels', running: true, label: 'Solar panels · 3.9 kWh' },
    { id: 'wind_turbine', running: true, label: 'Wind turbine · 6.3 kWh' },
    { id: 'batteries', running: true, value: 82, label: 'Batteries · charge' },
    { id: 'breaker_solar', running: true },
    { id: 'inverter_charger', running: true, value: 20, label: 'Inverters · 20 kWh' },
    { id: 'transformer', running: true, label: 'Power transformer · 0 kWh' },
    { id: 'meter_energy', running: true, value: 1284.5, value2: 912.3 },
    { id: 'breaker_generator', running: false },
    { id: 'generator', running: false, label: 'Industrial generator' },
    { id: 'consumption', running: true, label: 'Consumption · 20 kWh' },
  ],
};

// ─── 3. A coil coating line ──────────────────────────────────────────────────
// The strip runs along y = 200; the dosing and cooling circuits and the drive sit on y = 400.

export const LINE_SCENE: ScadaScene = {
  source: 'sample.scada.line',
  title: 'Coil coating line',
  settings: {
    width: 1300, height: 450, scale: 0.55, background: 'dots',
    elements: [
      E('reel_payoff', 'reel.payoff', 70, 140, { label: 'Payoff', max: 100 }),
      E('roller_entry', 'roller', 160, 140, { label: 'Entry roller', labelPos: 'n' }),
      E('joiner', 'joiner', 245, 140, { label: 'Joiner' }),
      E('accumulator_entry', 'loop.tower', 345, 140, { scale: 1.3, label: 'Entry accumulator', max: 100 }),
      E('brush_cleaning', 'brush.unit', 465, 140, { label: 'Cleaning', labelPos: 't' }),
      E('coater_prime', 'coater', 575, 140, { label: 'Prime coater', labelPos: 't' }),
      E('oven_prime', 'oven', 745, 140, { scale: 1.5, label: 'Prime oven', min: 0, max: 700 }),
      E('quench', 'quench', 915, 140, { label: 'Quench', labelPos: 't' }),
      E('accumulator_exit', 'loop.tower', 1020, 140, { scale: 1.3, label: 'Exit accumulator', max: 100 }),
      E('shear', 'shear', 1115, 140, { label: 'Shear' }),
      E('reel_rewind', 'reel.rewind', 1215, 140, { label: 'Rewind', max: 100, labelPos: 't' }),
      E('pump_dosing', 'pump.volute', 470, 350, { label: 'Dosing pump' }),
      E('tank_coating', 'tank.scale', 575, 350, { scale: 1.3, label: 'Coating', max: 100 }),
      E('pump_cooling', 'pump.volute', 800, 350, { label: 'Cooling pump' }),
      E('tank_cooling_water', 'tank.scale', 915, 350, { scale: 1.3, label: 'Cooling water', max: 100 }),
      E('drive', 'inverter', 1215, 350, { scale: 1.3, label: 'Drive' }),
    ],
    links: [
      L('reel_payoff.r', 'roller_entry.l', 'strip', { id: 'reel_payoff' }), L('roller_entry.r', 'joiner.l', 'strip', { id: 'reel_payoff' }), L('joiner.r', 'accumulator_entry.l', 'strip', { id: 'reel_payoff' }),
      L('accumulator_entry.r', 'brush_cleaning.l', 'strip', { id: 'reel_payoff' }), L('brush_cleaning.r', 'coater_prime.l', 'strip', { id: 'reel_payoff' }), L('coater_prime.r', 'oven_prime.l', 'strip', { id: 'reel_payoff' }),
      L('oven_prime.r', 'quench.l', 'strip', { id: 'reel_payoff' }), L('quench.r', 'accumulator_exit.l', 'strip', { id: 'reel_payoff' }), L('accumulator_exit.r', 'shear.l', 'strip', { id: 'reel_payoff' }),
      L('shear.r', 'reel_rewind.l', 'strip', { id: 'reel_payoff' }),
      L('tank_coating.l', 'pump_dosing.r', 'hose', { medium: 'custom', mediumColor: 'var(--warning)', id: 'pump_dosing' }),
      L('pump_dosing.t', 'coater_prime.b', 'hose', { medium: 'custom', mediumColor: 'var(--warning)', id: 'pump_dosing' }),
      L('tank_cooling_water.l', 'pump_cooling.r', 'pipe', { medium: 'cold', id: 'pump_cooling' }),
      L('pump_cooling.t', 'quench.b', 'pipe', { medium: 'cold', id: 'pump_cooling' }),
      L('drive.t', 'reel_rewind.b', 'cable', { id: 'drive' }),
    ],
  },
  rows: merge(
    on('reel_payoff', 'roller_entry', 'joiner', 'brush_cleaning', 'coater_prime', 'quench', 'shear', 'pump_dosing', 'pump_cooling', 'drive'),
    [
      { id: 'reel_payoff', value: 64 }, { id: 'accumulator_entry', running: true, value: 55 }, { id: 'accumulator_exit', running: true, value: 40 },
      { id: 'oven_prime', running: true, value: 505 }, { id: 'reel_rewind', running: true, value: 28 },
      { id: 'tank_coating', value: 63, running: true }, { id: 'tank_cooling_water', value: 78 }, { id: 'drive', value: 275 },
    ],
  ),
};

// ─── 4. A city water network ─────────────────────────────────────────────────

export const NETWORK_SCENE: ScadaScene = {
  source: 'sample.scada.network',
  title: 'Water network',
  settings: {
    width: 1300, height: 680, scale: 0.62, background: 'dots',
    elements: [
      E('borehole_1', 'well.bore', 70, 90, { label: 'Borehole 1' }),
      E('borehole_2', 'well.bore', 70, 240, { label: 'Borehole 2' }),
      E('borehole_3', 'well.bore', 70, 390, { label: 'Borehole 3' }),
      E('tee_wells', 'pipe.tee', 190, 240, { label: 'Wells tee', labelPos: 'n' }),
      E('clarifier', 'basin.clarifier', 330, 240, { scale: 1.2, label: 'Clarifier', labelPos: 't' }),
      E('chlorination', 'chlorinator', 330, 360, { scale: 1.2, label: 'Chlorination' }),
      E('pump_station', 'station.pump', 520, 360, { scale: 1.2, label: 'Pump station' }),
      E('meter_flow_station', 'meter.flow', 660, 360, { label: 'Flow' }),
      E('valve_butterfly', 'valve.butterfly', 750, 360, { label: 'Valve' }),
      E('cross_distribution', 'pipe.cross', 840, 360, { label: 'Distribution cross', labelPos: 'n' }),
      E('valve_prv', 'valve.prv', 945, 360, { label: 'PRV' }),
      E('tee_tower', 'pipe.tee', 1050, 360, { label: 'Tower tee', labelPos: 'n' }),
      E('meter_flow_tower', 'meter.flow', 1160, 360, { label: 'Flow' }),
      E('reservoir', 'reservoir.ground', 840, 170, { scale: 1.5, label: 'Reservoir', max: 100, labelPos: 't', valuePos: 'r' }),
      E('water_tower', 'tower.water', 1050, 190, { scale: 1.6, label: 'Water tower', max: 100, labelPos: 't', valuePos: 'r' }),
      E('sensor_pressure', 'sensor.pressure', 840, 500, { turn: '180', label: 'Pressure' }),
      E('hydrant', 'hydrant', 1050, 500, { turn: '180', label: 'Hydrant' }),
      E('remote_terminal_unit', 'rtu', 1050, 610, { label: 'RTU', labelPos: 'n' }),
    ],
    links: [
      L('borehole_1.r', 'tee_wells.t', 'pipe', { medium: 'water', id: 'borehole_1' }), L('borehole_2.r', 'tee_wells.l', 'pipe', { medium: 'water', id: 'borehole_2' }), L('borehole_3.r', 'tee_wells.b', 'pipe', { medium: 'water', id: 'borehole_3' }),
      L('tee_wells.r', 'clarifier.l', 'pipe', { medium: 'water', id: 'tee_wells' }),
      L('clarifier.b', 'chlorination.t', 'pipe', { medium: 'water', id: 'clarifier' }),
      L('chlorination.r', 'pump_station.l', 'pipe', { medium: 'water', id: 'chlorination', arrows: true }),
      L('pump_station.r', 'meter_flow_station.l', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('meter_flow_station.r', 'valve_butterfly.l', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('valve_butterfly.r', 'cross_distribution.l', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('cross_distribution.t', 'reservoir.b', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('cross_distribution.b', 'sensor_pressure.t', 'hose', { medium: 'water', id: 'pump_station' }),
      L('cross_distribution.r', 'valve_prv.l', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('valve_prv.r', 'tee_tower.l', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('tee_tower.t', 'water_tower.b', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('tee_tower.b', 'hydrant.t', 'pipe', { medium: 'water', id: 'pump_station' }),
      L('tee_tower.r', 'meter_flow_tower.l', 'hose', { medium: 'water', id: 'pump_station' }),
      L('sensor_pressure.r', 'remote_terminal_unit.l', 'wire', { id: 'remote_terminal_unit' }),
    ],
  },
  rows: merge(
    on('borehole_1', 'borehole_2', 'tee_wells', 'clarifier', 'chlorination', 'pump_station', 'meter_flow_station', 'valve_butterfly', 'cross_distribution', 'valve_prv', 'tee_tower', 'meter_flow_tower', 'sensor_pressure', 'hydrant', 'remote_terminal_unit'),
    [
      { id: 'borehole_3', running: false, status: 'warning' }, { id: 'meter_flow_station', value: 412 }, { id: 'meter_flow_tower', value: 96 },
      { id: 'reservoir', value: 71, running: true, label: 'Reservoir · 5 000 m³' }, { id: 'water_tower', value: 56, running: true },
      { id: 'sensor_pressure', value: 4.8 },
    ],
  ),
};

// ─── 5. A drilling rig ───────────────────────────────────────────────────────

export const RIG_SCENE: ScadaScene = {
  source: 'sample.scada.rig',
  title: 'Drilling rig',
  settings: {
    width: 1300, height: 700, scale: 0.7, background: 'none',
    elements: [
      E('derrick', 'rig.derrick', 420, 130, { scale: 2.2, label: 'Derrick', max: 100, labelPos: 'n' }),
      E('preventer', 'bop', 420, 330, { label: 'Preventer', labelPos: 'n' }),
      E('drill_bit', 'drill.bit', 420, 440, { label: 'Drill bit', scale: 0.9, labelPos: 'n' }),
      E('well_depth', 'meter.depth', 250, 330, { scale: 1.8, label: 'Well depth (m)', min: 0, max: 9000 }),
      E('drawworks', 'drawworks', 130, 560, { scale: 1.2, label: 'Drawworks' }),
      E('pump_mud', 'pump.volute', 800, 230, { scale: 1.2, label: 'Mud pump' }),
      E('valve_mud', 'valve.butterfly', 1000, 230, { label: 'Valve' }),
      E('tank_1', 'tank.scale', 900, 480, { scale: 1.3, label: 'Tank 1', max: 100 }),
      E('degasser', 'degasser', 1040, 480, { label: 'Degasser' }),
      E('tank_2', 'tank.scale', 1180, 480, { scale: 1.3, label: 'Tank 2', max: 100 }),
    ],
    links: [
      L('derrick.b:0.5', 'preventer.t', 'line'),
      L('preventer.b', 'drill_bit.t', 'line'),
      L('drawworks.t', 'derrick.l:0.85', 'line'),
      L('pump_mud.l', 'derrick.r:0.45', 'line'),
      L('valve_mud.l', 'pump_mud.r', 'line'),
      L('tank_2.t', 'valve_mud.r', 'line'),
      L('preventer.r', 'tank_1.l', 'line'),
      L('tank_1.r', 'degasser.l', 'line'),
      L('degasser.r', 'tank_2.l', 'line'),
    ],
  },
  rows: [
    { id: 'derrick', value: 58, running: true }, { id: 'drawworks', running: true }, { id: 'pump_mud', running: true }, { id: 'valve_mud', running: true },
    { id: 'preventer', running: false }, { id: 'drill_bit', running: true },
    { id: 'tank_1', value: 28 }, { id: 'degasser', running: true }, { id: 'tank_2', value: 27 },
    { id: 'well_depth', value: 1930 },
  ],
};

/** The rig's drilling parameters: a record the form widget edits (labels, units and words come from the source). */
export const RIG_PARAMS: SlotData['record'] = { wellDepth: 5000, drillSpeed: 25, mudFlow: 40.5, mode: 'auto', recirculate: true };

export const SCADA_SCENES: readonly ScadaScene[] = [POOL_SCENE, ENERGY_SCENE, LINE_SCENE, NETWORK_SCENE, RIG_SCENE];

/** The readings of every diagram as sample sources (`sample.scada.*`). */
export function scadaSources(now: number): Array<{ key: string; label: string; data: SlotData }> {
  return [
    ...[...SCADA_SCENES, ...SECTOR_SCENES].map((s) => ({ key: s.source, label: `Sample · ${s.title} readings`, data: table(s.rows, now) })),
    {
      key: 'sample.scada.rig.params', label: 'Sample · Drilling parameters (record)',
      data: {
        shape: 'record' as const, fetchedAt: new Date(now).toISOString(), record: RIG_PARAMS,
        recordMeta: {
          wellDepth: { label: 'Well depth', unit: 'm', decimals: 0, kind: 'number' as const },
          drillSpeed: { label: 'Drill speed', unit: 'm/h', decimals: 0, kind: 'number' as const },
          mudFlow: { label: 'Mud flow', unit: 'L/s', decimals: 1, kind: 'number' as const },
          mode: { label: 'Mode', kind: 'enum' as const, valueMap: { auto: { label: 'Automatic' }, manual: { label: 'Manual' } } },
          recirculate: { label: 'Recirculate mud', kind: 'boolean' as const },
        },
      } satisfies SlotData,
    },
  ];
}
