// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-storage.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "storage" sector sample: one process diagram with its readings and the board built around it (pure data).
// A battery energy storage yard on a single line: two battery containers feed a DC busbar (cable), the power conversion
// system turns the DC into AC, and the AC runs through a breaker, the step-up transformer, the revenue meter and a second
// breaker to the grid tie (single-line connections). Below, the protection and thermal management: a liquid cooling unit
// and a fire suppression cylinder piped to the first container, and a battery rack with its management system. The rack
// is running hot and carries an unacknowledged alarm.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const COOLANT = { medium: 'custom', mediumColor: 'var(--info)' };
const AGENT = { medium: 'custom', mediumColor: 'var(--text-secondary)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.storage',
  title: 'Battery energy storage',
  settings: {
    width: 1340, height: 590, scale: 0.85, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 40, text: 'Battery energy storage yard', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 450, h: 340, text: 'DC side · 1 000 V' },
      { kind: 'zone', x: 490, y: 60, w: 820, h: 340, text: 'AC side and grid tie' },
      { kind: 'zone', x: 20, y: 420, w: 1290, h: 150, text: 'Protection and thermal management' },
      { kind: 'text', x: 1130, y: 230, text: 'Grid · 33 kV', size: 's', align: 'middle' },
      { kind: 'text', x: 960, y: 480, text: 'Rack 3: cell temperature above the limit', size: 's', align: 'start', tone: 'error' },
    ],
    elements: [
      E('container_2', 'storage.container', 110, 135, { label: 'Container 2', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('container_1', 'storage.container', 110, 285, { label: 'Container 1', labelPos: 't', showValue: false, min: 0, max: 100, unit: '%', decimals: 0 }),
      E('dc_bus', 'storage.dcbus', 260, 285, { label: 'DC bus' }),
      E('power_conversion_system', 'storage.pcs', 400, 285, { label: 'PCS', unit: 'kW', decimals: 0 }),
      E('breaker_q1', 'sld.breaker', 560, 285, { label: 'Breaker Q1', labelPos: 't' }),
      E('transformer_step_up', 'storage.transformer.step', 700, 285, { label: 'Step-up transformer', unit: '%', decimals: 0 }),
      E('meter_revenue', 'storage.meter', 840, 285, { label: 'Revenue meter', unit: 'kW', decimals: 0 }),
      E('breaker_q2', 'sld.breaker', 980, 285, { label: 'Breaker Q2', labelPos: 't' }),
      E('grid', 'sld.grid', 1130, 285, { mirror: true, label: 'Grid', labelPos: 'n' }),
      E('cooling_unit', 'storage.cooling', 400, 490, { label: 'Cooling unit', unit: '°C', decimals: 0 }),
      E('fire_suppression', 'storage.fire', 560, 490, { label: 'Fire suppression', min: 0, max: 100 }),
      E('rack_3', 'storage.rack.battery', 720, 490, { label: 'Rack 3', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('battery_management_system', 'storage.bms', 860, 490, { label: 'BMS', min: 0, max: 100, unit: '%', decimals: 0 }),
    ],
    links: [
      L('container_1.r', 'dc_bus.l', 'cable', { id: 'dc1' }),
      L('container_2.r', 'dc_bus.t', 'cable', { id: 'dc2' }),
      L('dc_bus.r', 'power_conversion_system.l', 'cable', { id: 'dc3' }),
      L('power_conversion_system.r', 'breaker_q1.l', 'sld', { id: 'ac1' }),
      L('breaker_q1.r', 'transformer_step_up.l', 'sld', { id: 'ac2' }),
      L('transformer_step_up.r', 'meter_revenue.l', 'sld', { id: 'ac3' }),
      L('meter_revenue.r', 'breaker_q2.l', 'sld', { id: 'ac4' }),
      L('breaker_q2.r', 'grid.l', 'sld', { id: 'ac5' }),
      L('cooling_unit.t', 'container_1.b:0.25', 'pipe', { id: 'cl', mid: 375, ...COOLANT }),
      L('fire_suppression.t', 'container_1.b:0.75', 'pipe', { id: 'fr', mid: 395, ...AGENT }),
      L('rack_3.r', 'battery_management_system.l', 'wire', { id: 'can' }),
    ],
  },
  rows: [
    { id: 'container_2', running: true, value: 72 },
    { id: 'container_1', running: true, value: 68, status: 'warning' },
    { id: 'dc_bus', running: true },
    { id: 'power_conversion_system', running: true, value: 1250 },
    { id: 'breaker_q1', running: true },
    { id: 'transformer_step_up', running: true, value: 64 },
    { id: 'meter_revenue', running: true, value: 1180 },
    { id: 'breaker_q2', running: true },
    { id: 'grid', running: true },
    { id: 'cooling_unit', running: true, value: 24 },
    { id: 'fire_suppression', running: true, value: 90 },
    { id: 'rack_3', running: true, value: 58, status: 'critical', ack: false },
    { id: 'battery_management_system', running: true, value: 58 },
    { id: 'dc1', running: true }, { id: 'dc2', running: true }, { id: 'dc3', running: true },
    { id: 'ac1', running: true }, { id: 'ac2', running: true }, { id: 'ac3', running: true }, { id: 'ac4', running: true }, { id: 'ac5', running: true },
    { id: 'cl', running: true }, { id: 'fr', running: false }, { id: 'can', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Battery energy storage', [
  scene(SECTOR_SCENE, 9, 12),
  P('status', 'state', 'Yard status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Storage yard'), showSince: true }),
  P('soc', 'gauge', 'State of charge', 9, 3, 3, 3, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'State of charge', needle: true, $format: { unit: '%' },
    ranges: [{ to: 20, color: BAD }, { from: 20, to: 40, color: WARN }, { from: 40, color: OK }],
  }),
  P('power', 'stat.sparkline', 'Power', 9, 6, 3, 3, { series: 'sample.power' }, { label: 'Grid exchange', showChange: 'percent', fill: 'gradient', $format: { unit: 'kW', decimals: 0 } }),
  P('cell', 'stat.value', 'Cell temperature', 9, 9, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Hottest cell', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('flow', 'chart.area', 'Charge and discharge', 0, 12, 8, 5, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'kW', decimals: 0 } }),
  P('alarms', 'data.feed', 'Alarms', 8, 12, 4, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
