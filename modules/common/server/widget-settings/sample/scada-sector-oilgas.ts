// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-oilgas.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "oilgas" sector sample: one process diagram with its readings and the board built around it (pure data).
// A production facility: two wells (a gas well with a christmas tree and a pumpjack), a three-phase separator and a
// heater, the gas through a compressor and a pig launcher (with a flare on the riser), and the oil to a floating-roof
// tank, a transfer pump, an ESD valve and a loading arm.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const OIL = { medium: 'custom', mediumColor: 'var(--text-secondary)' };
const GAS = { medium: 'cold' };
const WATER = { medium: 'water' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.oilgas',
  title: 'Oil and gas facility',
  settings: {
    width: 1150, height: 480, scale: 0.65, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Oil and gas production facility', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 230, h: 395, text: 'Wells' },
      { kind: 'zone', x: 260, y: 50, w: 690, h: 170, text: 'Gas compression and flare' },
      { kind: 'zone', x: 260, y: 255, w: 380, h: 200, text: 'Separation' },
      { kind: 'text', x: 340, y: 112, text: 'Flare', size: 's', align: 'start' },
      { kind: 'text', x: 408, y: 378, text: 'Separator', size: 's', align: 'end' },
      { kind: 'zone', x: 650, y: 226, w: 480, h: 229, text: 'Storage and export' },
      { kind: 'text', x: 880, y: 176, text: 'To export pipeline', size: 's', align: 'start' },
      { kind: 'text', x: 1070, y: 282, text: 'To tanker', size: 's', align: 'start' },
    ],
    elements: [
      E('pumpjack', 'oilgas.pumpjack', 90, 190, { label: 'Pumpjack', labelPos: 't' }),
      E('wellhead', 'oilgas.wellhead', 200, 330, { label: 'Wellhead' }),
      E('tee_inlet', 'pipe.tee', 290, 330, { label: 'Inlet tee', labelPos: 'n' }),
      E('separator', 'oilgas.separator', 420, 330, { label: 'Separator', labelPos: 'n', showValue: false, max: 100 }),
      E('heater_oil', 'process.exchanger.shell', 550, 330, { label: 'Oil heater' }),
      E('elbow_water', 'pipe.elbow', 420, 395, { label: 'Water elbow', labelPos: 'n', turn: '180' }),
      E('produced_water', 'drain', 510, 395, { label: 'Produced water' }),
      E('tee_gas', 'pipe.tee', 420, 170, { label: 'Gas tee', labelPos: 'n' }),
      E('elbow_flare', 'pipe.elbow', 300, 170, { label: 'Flare elbow', labelPos: 'n', turn: '180' }),
      E('flare', 'oilgas.flare', 300, 105, { label: 'Flare', labelPos: 'n' }),
      E('compressor_gas', 'oilgas.compressor', 560, 170, { label: 'Gas compressor' }),
      E('pig_launcher', 'oilgas.pig.launcher', 700, 170, { label: 'Pig launcher' }),
      E('meter_export_gas', 'meter.flow', 840, 170, { label: 'Export gas', labelPos: 't' }),
      E('tank_crude', 'oilgas.tank.floating', 700, 330, { label: 'Crude storage', max: 100 }),
      E('pump_transfer', 'pump.volute', 830, 330, { label: 'Transfer pump' }),
      E('valve_esd', 'oilgas.valve.esd', 930, 330, { label: 'ESD valve' }),
      E('elbow_export', 'pipe.elbow', 1000, 330, { label: 'Export elbow', labelPos: 'n', turn: '90' }),
      E('loading_arm', 'oilgas.loading.arm', 1022, 265, { label: 'Loading arm', labelPos: 'n' }),
    ],
    links: [
      L('wellhead.r', 'tee_inlet.l', 'pipe', { id: 'wellhead', ...GAS }),
      L('pumpjack.b:0.8', 'tee_inlet.b', 'pipe', { id: 'pumpjack', mid: 400, ...OIL }),
      L('tee_inlet.r', 'separator.l', 'pipe', { id: 'separator', ...OIL }),
      L('separator.b', 'elbow_water.t', 'pipe', { id: 'separator', ...WATER }),
      L('elbow_water.r', 'produced_water.l', 'pipe', { id: 'separator', ...WATER }),
      L('separator.r', 'heater_oil.l', 'pipe', { id: 'separator', ...OIL }),
      L('heater_oil.r', 'tank_crude.l', 'pipe', { id: 'heater_oil', ...OIL }),
      L('separator.t', 'tee_gas.b', 'pipe', { id: 'separator', ...GAS }),
      L('tee_gas.l', 'elbow_flare.r', 'pipe', { id: 'flare', ...GAS }),
      L('elbow_flare.t', 'flare.b', 'pipe', { id: 'flare', ...GAS }),
      L('tee_gas.r', 'compressor_gas.l', 'pipe', { id: 'compressor_gas', ...GAS }),
      L('compressor_gas.t:0.259', 'pig_launcher.t', 'pipe', { id: 'compressor_gas', mid: 95, ...GAS }),
      L('pig_launcher.r', 'meter_export_gas.l', 'pipe', { id: 'pig_launcher', ...GAS }),
      L('tank_crude.r', 'pump_transfer.l', 'pipe', { id: 'tank_crude', ...OIL }),
      L('pump_transfer.r', 'valve_esd.l', 'pipe', { id: 'pump_transfer', ...OIL }),
      L('valve_esd.r', 'elbow_export.l', 'pipe', { id: 'valve_esd', ...OIL }),
    ],
  },
  rows: [
    { id: 'pumpjack', running: true, label: 'Pumpjack' },
    { id: 'wellhead', running: true, label: 'Wellhead' },
    { id: 'tee_inlet', running: true },
    { id: 'separator', running: true, value: 62, label: 'Separator' },
    { id: 'heater_oil', running: true },
    { id: 'elbow_water', running: true },
    { id: 'produced_water', running: true },
    { id: 'tee_gas', running: true },
    { id: 'elbow_flare', running: true },
    { id: 'flare', running: true },
    { id: 'compressor_gas', running: true, status: 'warning', label: 'Gas compressor' },
    { id: 'pig_launcher', running: true },
    { id: 'meter_export_gas', running: true, value: 41200, label: 'Export gas' },
    { id: 'tank_crude', running: true, value: 58, label: 'Crude storage' },
    { id: 'pump_transfer', running: true },
    { id: 'valve_esd', running: true },
    { id: 'elbow_export', running: true },
    { id: 'loading_arm', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Oil and gas facility', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Facility status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Production'), showSince: true }),
  P('wht', 'stat.value', 'Wellhead temperature', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Wellhead', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('pressure', 'gauge', 'Separator pressure', 9, 6, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Separator', needle: true, $format: { unit: 'bar' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('esd', 'control.button', 'Emergency shutdown', 9, 10, 3, 3, {}, {
    label: 'Close ESD valve', icon: 'fas fa-hand', fullWidth: true, confirmQuestion: 'Close the emergency shutdown valve now?', confirmLabel: 'Close',
  }),
  P('flow', 'chart.area', 'Export gas flow', 0, 13, 8, 6, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'Mm³/d', decimals: 0 } }),
  P('alarms', 'data.feed', 'Alarms', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
