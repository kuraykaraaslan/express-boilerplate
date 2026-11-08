// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-hydro.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "hydro" sector sample: one process diagram with its readings and the board built around it (pure data).
// A run-of-river hydropower scheme (dam with a spillway gate, intake, penstock, surge tank, Francis turbine, generator and
// breaker, a tailrace drain, a lift pump and a fish ladder) with a small harbour beside it (lock gate, ship, quay crane,
// container yard, harbour light and a buoy). The water runs in pipes; the generator feeds the breaker with a cable. Spillway
// gate 2 reports a position fault.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.hydro',
  title: 'Hydropower and harbour',
  settings: {
    width: 1220, height: 560, scale: 0.8, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Hydropower scheme and harbour', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 725, h: 330, text: 'Power station' },
      { kind: 'zone', x: 765, y: 60, w: 430, h: 330, text: 'Harbour', tone: 'info' },
      { kind: 'zone', x: 20, y: 405, w: 725, h: 140, text: 'Pumping and fish pass' },
      { kind: 'zone', x: 765, y: 405, w: 430, h: 140, text: 'Fairway' },
    ],
    elements: [
      E('reservoir', 'hydro.dam', 70, 250, { label: 'Reservoir', max: 100 }),
      E('spillway_gate_2', 'hydro.spillway', 175, 250, { label: 'Spillway gate 2', max: 100 }),
      E('intake', 'hydro.intake', 275, 250, { label: 'Intake' }),
      E('penstock', 'hydro.penstock', 395, 250, { length: '2', medium: 'water', label: 'Penstock' }),
      E('surge_tank', 'hydro.surge', 515, 250, { label: 'Surge tank', max: 100, medium: 'water' }),
      E('turbine_francis', 'hydro.turbine.francis', 595, 250, { label: 'Francis turbine', labelPos: 'n', medium: 'water' }),
      E('generator', 'hydro.generator.hydro', 595, 160, { labelPos: 't', label: 'Generator' }),
      E('breaker_grid', 'breaker', 690, 160, { label: 'Grid breaker' }),
      E('tailrace', 'drain', 700, 330, { label: 'Tailrace', medium: 'water' }),
      E('quay_crane_1', 'hydro.crane.quay', 860, 160, { label: 'Quay crane 1' }),
      E('yard_a', 'hydro.container.stack', 1000, 160, { label: 'Yard A', max: 100 }),
      E('lock_gate', 'hydro.lock.gate', 820, 300, { label: 'Lock gate', max: 100, valuePos: 'r' }),
      E('ship_mv_anna', 'hydro.ship', 990, 300, { label: 'MV Anna' }),
      E('harbour_light', 'hydro.bollard.light', 840, 480, { label: 'Harbour light' }),
      E('channel_buoy', 'hydro.buoy', 980, 480, { label: 'Channel buoy' }),
      E('pump_lift', 'hydro.pump.lift', 130, 475, { label: 'Lift pump', medium: 'water' }),
      E('fish_ladder', 'hydro.fishladder', 300, 475, { label: 'Fish ladder' }),
    ],
    links: [
      L('intake.r', 'penstock.l', 'pipe', { id: 'intake', medium: 'water' }),
      L('penstock.r', 'surge_tank.l', 'pipe', { id: 'penstock', medium: 'water' }),
      L('surge_tank.r', 'turbine_francis.l', 'pipe', { id: 'surge_tank', medium: 'water' }),
      L('turbine_francis.b', 'tailrace.l', 'pipe', { id: 'turbine_francis', medium: 'water' }),
      L('generator.r', 'breaker_grid.l', 'cable', { id: 'generator' }),
    ],
  },
  rows: [
    { id: 'reservoir', running: false, value: 78, label: 'Reservoir' },
    { id: 'spillway_gate_2', running: true, value: 35, status: 'warning', label: 'Gate 2 fault' },
    { id: 'intake', running: true },
    { id: 'penstock', running: true },
    { id: 'surge_tank', running: true, value: 62 },
    { id: 'turbine_francis', running: true },
    { id: 'generator', running: true },
    { id: 'breaker_grid', running: true },
    { id: 'tailrace', running: true },
    { id: 'ship_mv_anna', running: true },
    { id: 'quay_crane_1', running: true },
    { id: 'yard_a', running: true, value: 56, label: 'Yard A' },
    { id: 'lock_gate', running: false, value: 100, label: 'Lock gate' },
    { id: 'harbour_light', running: true },
    { id: 'channel_buoy', running: true },
    { id: 'pump_lift', running: true },
    { id: 'fish_ladder', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Hydropower and harbour', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Hydro unit 1'), showSince: true }),
  P('level', 'gauge', 'Reservoir level', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Reservoir', needle: true, $format: { unit: '%' },
    ranges: [{ to: 30, color: BAD }, { from: 30, to: 50, color: WARN }, { from: 50, color: OK }],
  }),
  P('power', 'stat.sparkline', 'Generator output', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Active power', showChange: 'percent', fill: 'gradient', $format: { unit: 'MW', decimals: 1 } }),
  P('gate', 'control.switch', 'Spillway gate 2', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Gate 2 auto', icon: 'fas fa-water', stateDisplay: 'pill' }),
  P('inflow', 'chart.line', 'Reservoir inflow', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'm³/s', decimals: 1 } }),
  P('events', 'data.feed', 'Plant events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
