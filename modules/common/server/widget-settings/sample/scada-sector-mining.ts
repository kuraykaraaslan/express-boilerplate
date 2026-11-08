// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-mining.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "mining" sector sample: one process diagram with its readings and the board built around it (pure data).
// A crushing and grinding plant: a haul truck tips into a feed hopper, a jaw crusher and a belt carry the ore up to a
// vibrating screen, the oversize goes to a cone crusher and on to the stockpile, the fines go to a ball mill that
// runs in closed circuit with a cyclone. Ore flow is drawn with single lines, the slurry with a pipe.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const SLURRY = { medium: 'custom', mediumColor: 'var(--text-secondary)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.mining',
  title: 'Mining and crushing',
  settings: {
    width: 1340, height: 830, scale: 0.85, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 40, text: 'Crushing and grinding plant', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 80, w: 560, h: 390, text: 'Primary crushing' },
      { kind: 'zone', x: 590, y: 80, w: 545, h: 465, text: 'Screening and secondary crushing' },
      { kind: 'zone', x: 1150, y: 400, w: 160, h: 150, text: 'Stockpile' },
      { kind: 'zone', x: 860, y: 560, w: 400, h: 250, text: 'Grinding and classification' },
      { kind: 'text', x: 458, y: 325, text: 'Jaw crusher', size: 's', align: 'start' },
      { kind: 'text', x: 1010, y: 405, text: 'Cone crusher', size: 's', align: 'start' },
      { kind: 'text', x: 1200, y: 675, text: 'Cyclone', size: 's', align: 'start' },
      { kind: 'text', x: 1160, y: 630, text: 'To flotation', size: 's', align: 'start' },
    ],
    elements: [
      E('haul_truck', 'mining.truck', 80, 140, { label: 'Haul truck', max: 100 }),
      E('feed_hopper', 'mining.hopper', 230, 215, { label: 'Feed hopper', max: 100 }),
      E('crusher_jaw', 'mining.crusher', 400, 320, { label: 'Jaw crusher', labelPos: 'n' }),
      E('belt_1', 'mining.conveyor', 472.25, 383, { length: '2', label: 'Belt 1' }),
      E('screen_vibrating', 'mining.screen', 700, 320, { label: 'Vibrating screen', labelPos: 't' }),
      E('crusher_cone', 'mining.cone', 960, 400, { label: 'Cone crusher', labelPos: 'n' }),
      E('belt_fines', 'mining.conveyor', 772.25, 383, { length: '2', label: 'Fines belt' }),
      E('belt_product', 'mining.conveyor', 1032.25, 463, { length: '2', label: 'Product belt' }),
      E('stockpile_product', 'mining.stockpile', 1230, 463, { label: 'Product', max: 100 }),
      E('ball_mill', 'mining.mill', 1000, 670, { label: 'Ball mill', labelPos: 't' }),
      E('cyclone', 'mining.cyclone', 1150, 670, { label: 'Cyclone', labelPos: 'n' }),
      E('tee_fines', 'pipe.tee', 900, 670, { label: 'Fines tee', labelPos: 'n', turn: '270', ...SLURRY }),
      E('elbow_return_1', 'pipe.elbow', 1150, 755, { label: 'Return elbow 1', labelPos: 'n', turn: '90', ...SLURRY }),
      E('elbow_return_2', 'pipe.elbow', 900, 755, { label: 'Return elbow 2', labelPos: 'n', turn: '180', ...SLURRY }),
    ],
    links: [
      L('haul_truck.r', 'feed_hopper.t', 'line', { id: 'haul_truck' }),
      L('feed_hopper.r', 'crusher_jaw.t', 'line', { id: 'feed_hopper' }),
      L('belt_1.r', 'screen_vibrating.l', 'line', { id: 'belt_1' }),
      L('screen_vibrating.r', 'crusher_cone.t', 'line', { id: 'screen_vibrating' }),
      L('belt_product.r', 'stockpile_product.l', 'line', { id: 'belt_product' }),
      L('belt_fines.r', 'tee_fines.t', 'line', { id: 'belt_fines' }),
      L('tee_fines.r', 'ball_mill.l', 'pipe', { id: 'ball_mill', ...SLURRY }),
      L('ball_mill.r', 'cyclone.l', 'pipe', { id: 'ball_mill', ...SLURRY }),
      L('elbow_return_1.l', 'elbow_return_2.r', 'pipe', { id: 'cyclone', ...SLURRY }),
    ],
  },
  rows: [
    { id: 'haul_truck', running: true, value: 78, label: 'Haul truck' },
    { id: 'feed_hopper', running: true, value: 55, label: 'Feed hopper' },
    { id: 'crusher_jaw', running: true, label: 'Jaw crusher' },
    { id: 'belt_1', running: true, label: 'Belt 1' },
    { id: 'screen_vibrating', running: true, label: 'Screen' },
    { id: 'crusher_cone', running: true, label: 'Cone crusher' },
    { id: 'belt_fines', running: true, status: 'warning', label: 'Fines belt' },
    { id: 'belt_product', running: true, label: 'Product belt' },
    { id: 'stockpile_product', running: true, value: 64, label: 'Product' },
    { id: 'ball_mill', running: true, label: 'Ball mill' },
    { id: 'cyclone', running: true },
    { id: 'tee_fines', running: true },
    { id: 'elbow_return_1', running: true },
    { id: 'elbow_return_2', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Mining and crushing', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Crushing plant'), showSince: true }),
  P('load', 'gauge', 'Crusher load', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Jaw crusher', needle: true, $format: { unit: '%' },
    ranges: [{ to: 75, color: OK }, { from: 75, to: 92, color: WARN }, { from: 92, color: BAD }],
  }),
  P('tph', 'stat.sparkline', 'Throughput', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Ore feed', showChange: 'percent', fill: 'gradient', $format: { unit: 't/h', decimals: 0 } }),
  P('bearing', 'stat.value', 'Mill bearing', 9, 10, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Mill bearing', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('power', 'chart.area', 'Mill power', 0, 13, 8, 6, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'kW', decimals: 0 } }),
  P('alarms', 'data.feed', 'Alarms', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
