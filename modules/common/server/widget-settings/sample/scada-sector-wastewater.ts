// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-wastewater.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "wastewater" sector sample: one process diagram with its readings and the board built around it (pure data).
// A treatment works: inlet works (lift station, bar screen, flume), aeration (blower and two basins), a dosed
// clarifier, UV disinfection and a metered outfall, and a sludge line (pump, thickener, pump, digester).

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const SLUDGE = { medium: 'custom', mediumColor: 'var(--text-secondary)' };
const AIR = { medium: 'custom', mediumColor: 'var(--border-strong)' };
const DOSE = { medium: 'custom', mediumColor: 'var(--warning)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.wastewater',
  title: 'Wastewater treatment',
  settings: {
    width: 1300, height: 640, scale: 0.65, background: 'dots',
    // Rules: a basin whose level is above 70 turns amber and says so.
    rules: [
      { target: 'basin_1', key: 'value', op: 'gt', value: '70', fillColor: 'var(--warning)', label: 'Basin 1 · high {value}' },
      { target: 'basin_2', key: 'value', op: 'gt', value: '70', fillColor: 'var(--warning)', label: 'Basin 2 · high {value}' },
    ],
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Wastewater treatment plant', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 170, w: 420, h: 135, text: 'Inlet works' },
      { kind: 'zone', x: 470, y: 50, w: 235, h: 255, text: 'Aeration' },
      { kind: 'zone', x: 715, y: 50, w: 580, h: 255, text: 'Clarification and disinfection' },
      { kind: 'zone', x: 300, y: 315, w: 590, h: 300, text: 'Sludge line' },
      { kind: 'text', x: 470, y: 429, text: 'Biogas pressure', size: 's', align: 'end' },
      { kind: 'text', x: 624, y: 400, text: 'Thickener', size: 's', align: 'end' },
      { kind: 'text', x: 684, y: 455, text: 'Thickened sludge pump', size: 's', align: 'start' },
    ],
    elements: [
      E('lift_station', 'wastewater.lift', 80, 235, { label: 'Lift station', max: 100 }),
      E('bar_screen', 'wastewater.screen', 215, 235, { label: 'Bar screen' }),
      E('inlet_flume', 'wastewater.flume', 360, 235, { label: 'Inlet flume', max: 100 }),
      E('blower_aeration', 'wastewater.blower', 590, 135, { label: 'Aeration blower' }),
      E('basin_1', 'wastewater.diffuser', 520, 235, { label: 'Basin 1', max: 100 }),
      E('basin_2', 'wastewater.diffuser', 660, 235, { label: 'Basin 2', max: 100 }),
      E('tee_dosing', 'pipe.tee', 745, 235, { label: 'Dosing tee', labelPos: 'n', turn: '180', medium: 'water' }),
      E('tank_coagulant', 'tank.scale', 920, 125, { label: 'Coagulant', max: 100, scale: 0.9 }),
      E('pump_dosing', 'wastewater.pump.dosing', 805, 125, { label: 'Dosing pump', mirror: true }),
      E('pipe_clarifier_out', 'pipe.straight', 900, 235, { label: 'Clarifier outlet', labelPos: 'n', medium: 'cold' }),
      E('clarifier', 'basin.clarifier', 850, 235, { label: 'Clarifier', labelPos: 't' }),
      E('uv_disinfection', 'wastewater.uv', 1010, 235, { label: 'UV disinfection' }),
      E('meter_effluent', 'wastewater.meter.smart', 1120, 235, { label: 'Effluent meter' }),
      E('outfall', 'drain', 1225, 235, { label: 'Outfall' }),
      E('pipe_sludge_down', 'pipe.straight', 850, 291.5, { label: 'Sludge drop', labelPos: 'n', turn: '90', medium: 'custom', mediumColor: 'var(--text-secondary)' }),
      E('elbow_sludge', 'pipe.elbow', 850, 356.5, { label: 'Sludge elbow', labelPos: 'n', turn: '90' }),
      E('pump_sludge', 'pump.volute', 760, 356.5, { label: 'Sludge pump', mirror: true }),
      E('thickener', 'wastewater.thickener', 640, 356.5, { label: 'Thickener', labelPos: 'n', mirror: true }),
      E('supernatant_return', 'drain', 360, 356.5, { label: 'Supernatant return', mirror: true }),
      E('pump_thickened', 'pump.volute', 640, 450, { label: 'Thickened sludge pump', labelPos: 'n', turn: '90' }),
      E('elbow_digester', 'pipe.elbow', 640, 530, { label: 'Digester elbow', labelPos: 'n', turn: '90' }),
      E('digester', 'wastewater.digester', 490, 530, { label: 'Digester', max: 100 }),
      E('sensor_gas_pressure', 'sensor.pressure', 490, 425, { label: 'Digester gas pressure', labelPos: 'n' }),
      E('to_dewatering', 'drain', 360, 530, { label: 'To dewatering', mirror: true }),
    ],
    links: [
      L('lift_station.r', 'bar_screen.l', 'pipe', { id: 'lift_station', medium: 'cold' }),
      L('bar_screen.r', 'inlet_flume.l', 'pipe', { id: 'bar_screen', medium: 'cold' }),
      L('inlet_flume.r', 'basin_1.l', 'pipe', { id: 'inlet_flume', medium: 'water' }),
      L('basin_1.r', 'basin_2.l', 'pipe', { id: 'basin_1', medium: 'water' }),
      L('basin_2.r', 'tee_dosing.l', 'pipe', { id: 'basin_2', medium: 'water' }),
      L('tee_dosing.r', 'clarifier.l', 'pipe', { id: 'basin_2', medium: 'water' }),
      L('blower_aeration.t:0.353', 'basin_1.t', 'pipe', { id: 'blower_aeration', mid: 80, ...AIR }),
      L('blower_aeration.t:0.353', 'basin_2.t', 'pipe', { id: 'blower_aeration', mid: 80, ...AIR }),
      L('tank_coagulant.l', 'pump_dosing.r', 'hose', { id: 'pump_dosing', ...DOSE }),
      L('pump_dosing.l', 'tee_dosing.t', 'pipe', { id: 'pump_dosing', ...DOSE }),
      L('clarifier.r', 'uv_disinfection.l', 'pipe', { id: 'clarifier', medium: 'cold' }),
      L('uv_disinfection.r', 'meter_effluent.l', 'pipe', { id: 'uv_disinfection', medium: 'cold' }),
      L('meter_effluent.r', 'outfall.l', 'pipe', { id: 'meter_effluent', medium: 'cold' }),
      L('pipe_sludge_down.b', 'elbow_sludge.t', 'pipe', { id: 'pump_sludge', ...SLUDGE }),
      L('elbow_sludge.l', 'pump_sludge.r', 'pipe', { id: 'pump_sludge', ...SLUDGE }),
      L('pump_sludge.l', 'thickener.r', 'pipe', { id: 'pump_sludge', ...SLUDGE }),
      L('thickener.l', 'supernatant_return.r', 'pipe', { id: 'thickener', medium: 'cold' }),
      L('thickener.b', 'pump_thickened.t', 'pipe', { id: 'pump_thickened', ...SLUDGE }),
      L('pump_thickened.b', 'elbow_digester.t', 'pipe', { id: 'pump_thickened', ...SLUDGE }),
      L('elbow_digester.l', 'digester.r', 'pipe', { id: 'pump_thickened', ...SLUDGE }),
      L('digester.l', 'to_dewatering.r', 'pipe', { id: 'digester', ...SLUDGE }),
      L('digester.t', 'sensor_gas_pressure.b', 'pipe', { id: 'digester', ...AIR }),
    ],
  },
  rows: [
    { id: 'lift_station', running: true, value: 58, label: 'Lift station' },
    { id: 'bar_screen', running: true },
    { id: 'inlet_flume', running: true, value: 46, label: 'Inlet flume' },
    { id: 'blower_aeration', running: true, label: 'Aeration blower' },
    { id: 'basin_1', running: true, value: 72, label: 'Basin 1' },
    { id: 'basin_2', running: true, value: 68, status: 'warning', label: 'Basin 2' },
    { id: 'tee_dosing', running: true },
    { id: 'pump_dosing', running: true },
    { id: 'tank_coagulant', value: 64, label: 'Coagulant' },
    { id: 'pipe_clarifier_out', running: true },
    { id: 'clarifier', running: true },
    { id: 'uv_disinfection', running: true, label: 'UV disinfection' },
    { id: 'meter_effluent', running: true, label: 'Effluent meter' },
    { id: 'outfall', running: true },
    { id: 'pipe_sludge_down', running: true },
    { id: 'elbow_sludge', running: true },
    { id: 'pump_sludge', running: true },
    { id: 'thickener', running: true },
    { id: 'supernatant_return', running: true },
    { id: 'pump_thickened', running: false },
    { id: 'elbow_digester', running: false },
    { id: 'digester', running: true, value: 71, label: 'Digester' },
    { id: 'sensor_gas_pressure', running: true },
    { id: 'to_dewatering', running: false },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Wastewater treatment', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Treatment works'), showSince: true }),
  P('digester', 'stat.value', 'Digester temperature', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Digester', icon: 'fas fa-temperature-half', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('blower', 'gauge', 'Blower load', 9, 6, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Blower load', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('dosing', 'control.switch', 'Coagulant dosing', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Dosing pump', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('energy', 'chart.line', 'Aeration power', 0, 13, 8, 6, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'kW', decimals: 0 } }),
  P('events', 'data.feed', 'Plant events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
