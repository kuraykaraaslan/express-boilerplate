// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-paper.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "paper" sector sample: one process diagram with its readings and the board built around it (pure data).
// A paper mill: a pulper makes stock, a stock chest and a disc refiner prepare it, a cleaner takes out the dirt and the
// accepted stock goes to the headbox of the machine. The web runs (strip lines) through the press section, the cylinder
// dryers and the calender onto the jumbo reel, which goes on to the winder and the roll wrapper. A broke pulper and chest
// take the rejects. Stock is drawn with pipes, the roll transport with a single line.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const STOCK = { medium: 'custom', mediumColor: 'var(--text-secondary)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.paper',
  title: 'Paper mill',
  settings: {
    width: 1340, height: 590, scale: 0.85, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 40, text: 'Paper machine', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 600, h: 280, text: 'Stock preparation' },
      { kind: 'zone', x: 640, y: 60, w: 670, h: 280, text: 'Paper machine' },
      { kind: 'text', x: 520, y: 290, text: 'Cleaner', size: 's', align: 'end' },
      { kind: 'zone', x: 20, y: 360, w: 600, h: 200, text: 'Broke system' },
      { kind: 'zone', x: 640, y: 360, w: 670, h: 200, text: 'Finishing' },
    ],
    elements: [
      E('pulper', 'paper.pulper', 90, 170, { label: 'Pulper', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('machine_chest', 'paper.chest', 250, 170, { label: 'Machine chest', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('refiner', 'paper.refiner', 410, 170, { label: 'Refiner', labelPos: 't' }),
      E('cleaner', 'paper.cleaner', 560, 240, { label: 'Cleaner', labelPos: 'n' }),
      E('headbox', 'paper.headbox', 700, 170, { label: 'Headbox', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('press_section', 'paper.machine.press', 840, 170, { label: 'Press section' }),
      E('dryers', 'paper.dryer.cylinder', 985, 170, { label: 'Dryers', min: 0, max: 10, unit: 'bar', decimals: 1 }),
      E('calender', 'paper.calender', 1120, 170, { label: 'Calender' }),
      E('jumbo_reel', 'paper.reel', 1240, 170, { label: 'Jumbo reel', labelPos: 't', showValue: false, min: 0, max: 100, unit: '%', decimals: 0 }),
      E('broke_pulper', 'paper.pulper', 90, 450, { label: 'Broke pulper', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('broke_chest', 'paper.chest', 280, 450, { label: 'Broke chest', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('winder', 'paper.winder', 1240, 450, { label: 'Winder' }),
      E('roll_wrapper', 'paper.wrapper', 1060, 450, { label: 'Roll wrapper' }),
    ],
    links: [
      L('pulper.r', 'machine_chest.l', 'pipe', { id: 'p1', ...STOCK }),
      L('machine_chest.r', 'refiner.l', 'pipe', { id: 'p2', ...STOCK }),
      L('refiner.b', 'cleaner.l', 'pipe', { id: 'p3', ...STOCK }),
      L('cleaner.t', 'headbox.l', 'pipe', { id: 'p4', ...STOCK }),
      L('cleaner.b', 'broke_chest.t', 'pipe', { id: 'p5', ...STOCK }),
      L('broke_pulper.r', 'broke_chest.l', 'pipe', { id: 'p6', ...STOCK }),
      L('headbox.r', 'press_section.l', 'strip', { id: 's1' }),
      L('press_section.r', 'dryers.l', 'strip', { id: 's2' }),
      L('dryers.r', 'calender.l', 'strip', { id: 's3' }),
      L('calender.r', 'jumbo_reel.l', 'strip', { id: 's4' }),
      L('jumbo_reel.b', 'winder.t', 'strip', { id: 's5' }),
      L('winder.l', 'roll_wrapper.r', 'line', { id: 'l1' }),
    ],
  },
  rows: [
    { id: 'pulper', running: true, value: 62 },
    { id: 'machine_chest', running: true, value: 71 },
    { id: 'refiner', running: true, status: 'warning' },
    { id: 'cleaner', running: true },
    { id: 'headbox', running: true, value: 58 },
    { id: 'press_section', running: true },
    { id: 'dryers', running: true, value: 6.5 },
    { id: 'calender', running: true, status: 'critical', ack: false },
    { id: 'jumbo_reel', running: true, value: 64 },
    { id: 'broke_pulper', running: false, value: 35 },
    { id: 'broke_chest', running: true, value: 48 },
    { id: 'winder', running: true },
    { id: 'roll_wrapper', running: true },
    { id: 'p1', running: true }, { id: 'p2', running: true }, { id: 'p3', running: true }, { id: 'p4', running: true }, { id: 'p5', running: true }, { id: 'p6', running: false },
    { id: 's1', running: true }, { id: 's2', running: true }, { id: 's3', running: true }, { id: 's4', running: true }, { id: 's5', running: true },
    { id: 'l1', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Paper mill', [
  scene(SECTOR_SCENE, 9, 12),
  P('status', 'state', 'Machine status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Paper machine'), showSince: true }),
  P('speed', 'gauge', 'Machine speed', 9, 3, 3, 3, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Reel speed', needle: true, $format: { unit: '%' },
    ranges: [{ to: 80, color: OK }, { from: 80, to: 94, color: WARN }, { from: 94, color: BAD }],
  }),
  P('tpd', 'stat.sparkline', 'Production', 9, 6, 3, 3, { series: 'sample.power' }, { label: 'Output', showChange: 'percent', fill: 'gradient', $format: { unit: 't/h', decimals: 1 } }),
  P('moist', 'stat.value', 'Moisture', 9, 9, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Reel moisture', icon: 'fas fa-droplet', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '%', decimals: 1 },
  }),
  P('steam', 'chart.area', 'Dryer steam', 0, 12, 8, 5, { series: 'sample.power' }, { legend: 'none', $format: { unit: 't/h', decimals: 1 } }),
  P('alarms', 'data.feed', 'Alarms', 8, 12, 4, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
