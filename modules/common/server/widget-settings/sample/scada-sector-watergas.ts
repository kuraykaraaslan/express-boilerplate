// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-watergas.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "watergas" sample: one process diagram with its readings and the board built around it (pure data).
// An apartment block's water service riser and one flat: the street main passes the building meter and the motorised
// main valve into the basement pump room (pressure-reducing station, booster set, sump flood sensor with its beacon),
// rises to the rooftop tank, and feeds the flat by gravity (shut-off valve, water meter, hammer arrestor, purifier). The
// flat's gas comes through a shut-off valve and a cabinet meter to the boiler. One signal loop runs from the alarm panel
// through the CO detector, the gas detector, the sink leak sensor and the washing-machine flood sensor. The gas detector
// reports 22 % of the lower explosive limit.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const WATER = { medium: 'water' };
const GAS = { medium: 'custom', mediumColor: 'var(--warning)' };
const SIGNAL = { medium: 'custom', mediumColor: 'var(--info)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.watergas',
  title: 'Water and gas safety',
  settings: {
    width: 1540, height: 575, scale: 0.8, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Apartment block riser and flat 4B', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 560, h: 210, text: 'Street and building entry' },
      { kind: 'zone', x: 20, y: 294, w: 810, h: 260, text: 'Basement pump room', tone: 'info' },
      { kind: 'zone', x: 690, y: 60, w: 220, h: 210, text: 'Roof' },
      { kind: 'zone', x: 940, y: 60, w: 580, h: 494, text: 'Flat 4B', tone: 'warning' },
    ],
    elements: [
      // Street and building entry
      E('street_main', 'drain', 80, 170, { label: 'Street main', medium: 'water' }),
      E('meter_building', 'watergas.meter.water', 190, 170, { label: 'Building meter', unit: ' m³', decimals: 0 }),
      E('valve_main', 'watergas.valve.water', 300, 170, { label: 'Main valve' }),
      // Basement pump room
      E('sensor_sump_flood', 'watergas.sensor.flood', 130, 420, { label: 'Sump flood', max: 20, unit: ' cm', decimals: 0 }),
      E('beacon_basement', 'safety.beacon', 250, 420, { label: 'Basement alarm' }),
      E('valve_prv', 'watergas.prv.building', 440, 420, { label: 'PRV', max: 10, unit: ' bar', decimals: 1 }),
      E('booster_set', 'watergas.booster', 550, 420, { label: 'Booster set', max: 8, unit: ' bar', decimals: 1 }),
      E('arrestor_booster', 'watergas.hammer', 660, 420, { label: 'Arrestor' }),
      // Roof
      E('roof_tank', 'watergas.tank.roof', 800, 170, { label: 'Roof tank', max: 100, unit: ' %', decimals: 0 }),
      // Flat 4B: water
      E('valve_flat', 'watergas.valve.water', 1010, 170, { label: 'Flat valve' }),
      E('meter_water_flat', 'watergas.meter.water', 1120, 170, { label: 'Water meter', unit: ' m³', decimals: 1 }),
      E('arrestor_flat', 'watergas.hammer', 1230, 170, { label: 'Arrestor' }),
      E('purifier', 'watergas.purifier', 1340, 170, { label: 'Purifier', max: 100, unit: ' %', decimals: 0 }),
      E('tap_kitchen', 'drain', 1450, 170, { label: 'Kitchen tap', medium: 'water' }),
      // Flat 4B: gas
      E('valve_gas', 'watergas.valve.gas', 1010, 320, { label: 'Gas valve' }),
      E('meter_gas', 'watergas.meter.gas', 1120, 320, { label: 'Gas meter', unit: ' m³', decimals: 1 }),
      E('boiler', 'hvac.boiler', 1230, 320, { label: 'Boiler' }),
      // Flat 4B: the signal loop
      E('alarm_panel', 'safety.hmi', 1010, 470, { label: 'Alarm panel' }),
      E('detector_co_hall', 'watergas.detector.co', 1120, 470, { label: 'CO · hall', max: 100, unit: ' ppm', decimals: 0 }),
      E('detector_gas_kitchen', 'watergas.detector.gas', 1230, 470, { label: 'Gas · kitchen', max: 100, unit: ' % LEL', decimals: 0 }),
      E('sensor_leak_sink', 'watergas.sensor.leak', 1340, 470, { label: 'Leak · sink' }),
      E('sensor_flood_washer', 'watergas.sensor.flood', 1450, 470, { label: 'Flood · washer', max: 20, unit: ' cm', decimals: 0 }),
    ],
    links: [
      L('street_main.r', 'meter_building.l', 'pipe', { id: 'p1', ...WATER }),
      L('meter_building.r', 'valve_main.l', 'pipe', { id: 'p2', ...WATER }),
      L('valve_main.r', 'valve_prv.l', 'pipe', { id: 'p3', mid: 370, ...WATER }),
      L('valve_prv.r', 'booster_set.l', 'pipe', { id: 'p4', ...WATER }),
      L('booster_set.r', 'arrestor_booster.l', 'pipe', { id: 'p5', ...WATER }),
      L('arrestor_booster.r', 'roof_tank.l', 'pipe', { id: 'p6', mid: 730, ...WATER }),
      L('roof_tank.r', 'valve_flat.l', 'pipe', { id: 'p7', ...WATER }),
      L('valve_flat.r', 'meter_water_flat.l', 'pipe', { id: 'p8', ...WATER }),
      L('meter_water_flat.r', 'arrestor_flat.l', 'pipe', { id: 'p9', ...WATER }),
      L('arrestor_flat.r', 'purifier.l', 'pipe', { id: 'p10', ...WATER }),
      L('purifier.r', 'tap_kitchen.l', 'pipe', { id: 'p11', ...WATER }),
      L('valve_gas.r', 'meter_gas.l', 'pipe', { id: 'g1', ...GAS }),
      L('meter_gas.r', 'boiler.l', 'pipe', { id: 'g2', ...GAS }),
      L('sensor_sump_flood.r', 'beacon_basement.l', 'wire', { id: 's0', ...SIGNAL }),
      L('alarm_panel.r', 'detector_co_hall.l', 'wire', { id: 's1', ...SIGNAL }),
      L('detector_co_hall.r', 'detector_gas_kitchen.l', 'wire', { id: 's2', ...SIGNAL }),
      L('detector_gas_kitchen.r', 'sensor_leak_sink.l', 'wire', { id: 's3', ...SIGNAL }),
      L('sensor_leak_sink.r', 'sensor_flood_washer.l', 'wire', { id: 's4', ...SIGNAL }),
    ],
  },
  rows: [
    { id: 'street_main', running: true },
    { id: 'meter_building', running: true, value: 18452 },
    { id: 'valve_main', running: true },
    { id: 'sensor_sump_flood', running: true, value: 0 },
    { id: 'beacon_basement', running: false },
    { id: 'valve_prv', running: true, value: 3.2, value2: 6.5 },
    { id: 'booster_set', running: true, value: 4.2 },
    { id: 'arrestor_booster', running: true },
    { id: 'roof_tank', running: true, value: 72 },
    { id: 'valve_flat', running: true },
    { id: 'meter_water_flat', running: true, value: 128.4 },
    { id: 'arrestor_flat', running: false },
    { id: 'purifier', running: true, value: 80 },
    { id: 'tap_kitchen', running: true },
    { id: 'valve_gas', running: true },
    { id: 'meter_gas', running: true, value: 842.6 },
    { id: 'boiler', running: true },
    { id: 'alarm_panel', running: true, status: 'warning' },
    { id: 'detector_co_hall', running: true, value: 4 },
    { id: 'detector_gas_kitchen', running: true, value: 22, status: 'warning', label: 'Gas · 22 % LEL' },
    { id: 'sensor_leak_sink', running: true },
    { id: 'sensor_flood_washer', running: true, value: 0 },
    { id: 'p1', running: true }, { id: 'p2', running: true }, { id: 'p3', running: true }, { id: 'p4', running: true },
    { id: 'p5', running: true }, { id: 'p6', running: true }, { id: 'p7', running: true }, { id: 'p8', running: true },
    { id: 'p9', running: true }, { id: 'p10', running: true }, { id: 'p11', running: true },
    { id: 'g1', running: true }, { id: 'g2', running: true },
    { id: 's0', running: true }, { id: 's1', running: true }, { id: 's2', running: true, status: 'warning' }, { id: 's3', running: true }, { id: 's4', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Water and gas safety', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Building water', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Water service'), showSince: true }),
  P('pressure', 'gauge', 'Riser pressure', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Riser pressure', needle: true, $format: { unit: 'bar' },
    ranges: [{ to: 25, color: BAD }, { from: 25, to: 75, color: OK }, { from: 75, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('flow', 'stat.sparkline', 'Water flow', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Water flow', showChange: 'percent', fill: 'gradient', $format: { unit: 'm³/h', decimals: 1 } }),
  P('gasvalve', 'control.switch', 'Gas valve', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Gas valve open', icon: 'fas fa-fire-flame-simple', stateDisplay: 'pill' }),
  P('gas', 'chart.line', 'Gas level, kitchen', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'ppm', decimals: 0 } }),
  P('events', 'data.feed', 'Safety events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
