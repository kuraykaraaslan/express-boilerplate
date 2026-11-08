// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-utility.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "utility" sector sample: one process diagram with its readings and the board built around it (pure data).
// A district water supply and its city infrastructure: a reservoir with chlorine dosing, a booster set, a surge vessel,
// a flow-control valve and a meter pit on the trunk main, then the district with an air-release valve, hydrants, a pump
// kiosk and a customer meter; a sewer with two manholes; street assets (a tram, a bus, a level crossing, a parking meter)
// on a controller; and a pump house cluster of local gauges.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const DATA = { medium: 'custom', mediumColor: 'var(--info)' };
const DOSE = { medium: 'custom', mediumColor: 'var(--warning)' };
const SEWER = { medium: 'custom', mediumColor: 'var(--text-secondary)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.utility',
  title: 'Utility network',
  settings: {
    width: 1300, height: 790, scale: 0.8, background: 'dots',
    // Rules: a manhole whose level is above 80 turns amber and says so.
    rules: [
      { target: 'manhole_2', key: 'value', op: 'gt', value: '80', fillColor: 'var(--warning)', label: 'Manhole 2 · high {value}' },
    ],
    shapes: [
      { kind: 'text', x: 30, y: 34, text: 'District water and city infrastructure', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 56, w: 640, h: 250, text: 'Source and boosting' },
      { kind: 'zone', x: 680, y: 56, w: 600, h: 250, text: 'District 4 distribution' },
      { kind: 'zone', x: 20, y: 326, w: 380, h: 200, text: 'Sewer' },
      { kind: 'zone', x: 420, y: 326, w: 860, h: 200, text: 'Street assets' },
      { kind: 'zone', x: 20, y: 546, w: 1260, h: 220, text: 'Pump house instruments' },
      { kind: 'text', x: 262, y: 104, text: 'Chlorine drum', size: 's', align: 'start' },
    ],
    elements: [
      E('reservoir_ground', 'reservoir.ground', 100, 210, { label: 'Ground reservoir', max: 100 }),
      E('tank_chlorine', 'networkx.tank.chlorine', 211, 120, { label: 'Chlorine tank', labelPos: 'n', valuePos: 'r', max: 100 }),
      E('dosing_chlorine', 'chlorinator', 230, 225, { label: 'Dosing', max: 100 }),
      E('booster_set', 'networkx.set.booster', 360, 210, { label: 'Booster set', max: 100 }),
      E('surge_vessel', 'networkx.tank.surge', 490, 210, { label: 'Surge vessel', max: 100 }),
      E('valve_flow_control', 'networkx.valve.fcv', 590, 210, { label: 'Flow control', labelPos: 't' }),
      E('meter_pit', 'networkx.pit.meter', 730, 210, { label: 'Meter pit', unit: 'L/s' }),
      E('valve_air', 'networkx.valve.air', 830, 210, { label: 'Air valve' }),
      E('tee_hydrant', 'pipe.tee', 930, 210, { label: 'Hydrant tee', labelPos: 'n', turn: '180', medium: 'water' }),
      E('hydrant_pillar', 'networkx.hydrant.pillar', 930, 120, { label: 'Pillar hydrant', labelPos: 'n' }),
      E('pump_kiosk', 'city.kiosk.pump', 1030, 210, { label: 'Pump kiosk' }),
      E('tee_customer', 'pipe.tee', 1130, 210, { label: 'Customer tee', labelPos: 'n', turn: '180', medium: 'water' }),
      E('hydrant_street', 'city.hydrant', 1130, 120, { label: 'Street hydrant', labelPos: 'n' }),
      E('meter_customer', 'city.meter.water', 1230, 210, { label: 'Customer meter', unit: 'm³/h', decimals: 1 }),

      E('manhole_1', 'city.manhole', 90, 430, { label: 'Manhole 1', max: 100 }),
      E('manhole_2', 'city.manhole', 220, 430, { label: 'Manhole 2', max: 100 }),
      E('to_sewer', 'drain', 340, 430, { label: 'To sewer' }),

      E('tram_7', 'city.tram', 520, 430, { label: 'Tram 7' }),
      E('bus_31', 'city.bus', 650, 430, { label: 'Bus 31', max: 100 }),
      E('level_crossing', 'city.crossing', 750, 430, { label: 'Level crossing' }),
      E('meter_parking', 'city.meter.parking', 880, 430, { label: 'Parking meter', unit: '€', decimals: 2 }),
      E('street_controller', 'rtu', 1000, 430, { label: 'Street controller' }),
      E('camera_street', 'city.camera', 1120, 430, { label: 'Camera' }),

      E('gauge_suction_head', 'gauge.manometer.u', 100, 650, { label: 'Suction head', max: 100, unit: 'kPa' }),
      E('gauge_seal_flush', 'gauge.rotameter', 245, 650, { label: 'Seal flush', max: 100, unit: 'L/h' }),
      E('gauge_motor_current', 'gauge.analog', 390, 650, { label: 'Motor current', max: 100, unit: 'A' }),
      E('gauge_pump_speed', 'gauge.tachometer', 535, 650, { label: 'Pump speed', max: 3000, unit: 'rpm' }),
      E('gauge_tank_level', 'gauge.bargraph', 680, 650, { label: 'Tank level', max: 100, unit: '%' }),
      E('gauge_bearing', 'gauge.thermometer.dial', 825, 650, { label: 'Bearing', max: 120, unit: '°C' }),
      E('gauge_room_humidity', 'gauge.hygrometer', 970, 650, { label: 'Room humidity', max: 100, unit: '%' }),
      E('gauge_volume_total', 'gauge.counter', 1115, 650, { label: 'Volume total', unit: 'm³', decimals: 0 }),
    ],
    links: [
      L('reservoir_ground.r', 'dosing_chlorine.l', 'pipe', { id: 'reservoir_ground', medium: 'water' }),
      L('tank_chlorine.b', 'dosing_chlorine.t:0.27', 'hose', { id: 'dosing_chlorine', ...DOSE }),
      L('dosing_chlorine.r', 'booster_set.l', 'pipe', { id: 'dosing_chlorine', medium: 'water' }),
      L('booster_set.r', 'surge_vessel.l', 'pipe', { id: 'booster_set', medium: 'water' }),
      L('surge_vessel.r', 'valve_flow_control.l', 'pipe', { id: 'surge_vessel', medium: 'water' }),
      L('valve_flow_control.r', 'meter_pit.l', 'pipe', { id: 'valve_flow_control', medium: 'water' }),
      L('meter_pit.r', 'valve_air.l', 'pipe', { id: 'meter_pit', medium: 'water' }),
      L('valve_air.r', 'tee_hydrant.l', 'pipe', { id: 'valve_air', medium: 'water' }),
      L('tee_hydrant.t', 'hydrant_pillar.b', 'pipe', { id: 'tee_hydrant', medium: 'water' }),
      L('tee_hydrant.r', 'pump_kiosk.l', 'pipe', { id: 'tee_hydrant', medium: 'water' }),
      L('pump_kiosk.r', 'tee_customer.l', 'pipe', { id: 'pump_kiosk', medium: 'water' }),
      L('tee_customer.t', 'hydrant_street.b', 'pipe', { id: 'tee_customer', medium: 'water' }),
      L('tee_customer.r', 'meter_customer.l', 'pipe', { id: 'tee_customer', medium: 'water' }),
      L('manhole_1.r', 'manhole_2.l', 'pipe', { id: 'manhole_1', ...SEWER }),
      L('manhole_2.r', 'to_sewer.l', 'pipe', { id: 'manhole_2', ...SEWER }),
      L('street_controller.l', 'meter_parking.r', 'wire', { id: 'street_controller', ...DATA }),
      L('meter_parking.l', 'level_crossing.r', 'wire', { id: 'meter_parking', ...DATA }),
      L('street_controller.r', 'camera_street.l', 'wire', { id: 'street_controller', ...DATA }),
    ],
  },
  rows: [
    { id: 'reservoir_ground', running: true, value: 72, label: 'Ground reservoir' },
    { id: 'tank_chlorine', running: true, value: 64, label: 'Chlorine drum' },
    { id: 'dosing_chlorine', running: true, value: 58, label: 'Dosing' },
    { id: 'booster_set', running: true, value: 62, label: 'Booster set' },
    { id: 'surge_vessel', running: true, value: 55, label: 'Surge vessel' },
    { id: 'valve_flow_control', running: true },
    { id: 'meter_pit', running: true, value: 41.5, label: 'Meter pit' },
    { id: 'valve_air', running: true },
    { id: 'tee_hydrant', running: true },
    { id: 'hydrant_pillar', running: false },
    { id: 'pump_kiosk', running: true },
    { id: 'tee_customer', running: true },
    { id: 'hydrant_street', running: false },
    { id: 'meter_customer', running: true, value: 3.4, label: 'Customer meter' },
    { id: 'manhole_1', running: true, value: 46, label: 'Manhole 1' },
    { id: 'manhole_2', running: true, value: 86, status: 'warning', label: 'Manhole 2' },
    { id: 'to_sewer', running: true },
    { id: 'tram_7', running: true },
    { id: 'bus_31', running: true, value: 60, label: 'Bus 31' },
    { id: 'level_crossing', running: true },
    { id: 'meter_parking', running: true, value: 2.4, label: 'Parking meter' },
    { id: 'street_controller', running: true },
    { id: 'camera_street', running: true },
    { id: 'gauge_suction_head', running: true, value: 38, label: 'Suction head' },
    { id: 'gauge_seal_flush', running: true, value: 66, label: 'Seal flush' },
    { id: 'gauge_motor_current', running: true, value: 62, label: 'Motor current' },
    { id: 'gauge_pump_speed', running: true, value: 1450, label: 'Pump speed' },
    { id: 'gauge_tank_level', running: true, value: 70, label: 'Tank level' },
    { id: 'gauge_bearing', running: true, value: 55, label: 'Bearing' },
    { id: 'gauge_room_humidity', running: true, value: 48, label: 'Room humidity' },
    { id: 'gauge_volume_total', running: true, value: 128430, label: 'Volume total' },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Utility network', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Network status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('District 4'), showSince: true }),
  P('booster', 'gauge', 'Booster load', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Booster load', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('demand', 'stat.sparkline', 'District demand', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Demand', showChange: 'percent', fill: 'gradient', $format: { unit: 'L/s', decimals: 0 } }),
  P('kiosk', 'control.switch', 'Pump kiosk', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Pump kiosk', icon: 'fas fa-faucet-drip', stateDisplay: 'pill' }),
  P('level', 'chart.line', 'Reservoir level', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'm', decimals: 1 } }),
  P('events', 'data.feed', 'Network events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
