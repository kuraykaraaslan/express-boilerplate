// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-steel.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "steel" sector sample: one process diagram with its readings and the board built around it (pure data).
// An integrated steel plant: a blast furnace taps hot metal into a pot, the converter refines it, an electric arc
// furnace adds scrap steel, the ladle carries the heat to the continuous caster, the slabs are reheated and rolled in a
// stand, cooled on a bed and coiled. An overhead crane serves the melt shop. The hot metal is drawn with a pipe, the
// transport with single lines and the rolled strip with a strip line. The mill stand carries an unacknowledged alarm.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const MOLTEN = { fillColor: 'var(--warning)' };
const IRON = { medium: 'custom', mediumColor: 'var(--warning)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.steel',
  title: 'Steel plant',
  settings: {
    width: 1340, height: 545, scale: 0.85, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 40, text: 'Steel plant', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 600, h: 440, text: 'Melt shop' },
      { kind: 'zone', x: 640, y: 60, w: 670, h: 240, text: 'Hot rolling' },
      { kind: 'zone', x: 640, y: 320, w: 670, h: 180, text: 'Casting and reheating' },
    ],
    elements: [
      E('blast_furnace', 'steel.furnace.blast', 90, 170, { label: 'Blast furnace', labelPos: 't', showValue: false, min: 0, max: 1600, unit: '°C', decimals: 0 }),
      E('overhead_crane', 'steel.crane.overhead', 330, 170, { label: 'Overhead crane', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('arc_furnace', 'steel.furnace.arc', 560, 170, { label: 'Arc furnace', min: 0, max: 100, unit: '%', decimals: 0, ...MOLTEN }),
      E('hot_metal_pot', 'steel.pot.hotmetal', 250, 400, { label: 'Hot metal pot', min: 0, max: 100, unit: '%', decimals: 0, ...MOLTEN }),
      E('converter', 'steel.converter', 410, 400, { label: 'Converter', min: 0, max: 80, unit: '°', decimals: 0 }),
      E('ladle', 'steel.ladle', 560, 400, { label: 'Ladle', showValue: false, min: 0, max: 100, unit: '%', decimals: 0, ...MOLTEN }),
      E('caster', 'steel.caster', 740, 400, { label: 'Caster' }),
      E('reheating_furnace', 'steel.furnace.reheat', 900, 400, { label: 'Reheating furnace', min: 0, max: 1400, unit: '°C', decimals: 0 }),
      E('mill_stand', 'steel.stand.roll', 1000, 170, { label: 'Mill stand' }),
      E('cooling_bed', 'steel.bed.cooling', 1130, 170, { label: 'Cooling bed' }),
      E('coil', 'steel.coil', 1250, 170, { label: 'Coil', min: 0, max: 100, unit: '%', decimals: 0 }),
    ],
    links: [
      L('blast_furnace.b', 'hot_metal_pot.l', 'pipe', { id: 'tap', ...IRON }),
      L('hot_metal_pot.r', 'converter.l', 'line', { id: 'l1' }),
      L('converter.r', 'ladle.l', 'line', { id: 'l2' }),
      L('arc_furnace.b', 'ladle.t', 'line', { id: 'l3' }),
      L('ladle.r', 'caster.l', 'line', { id: 'l4' }),
      L('caster.r', 'reheating_furnace.l', 'line', { id: 'l5' }),
      L('reheating_furnace.r', 'mill_stand.b', 'line', { id: 'l6' }),
      L('mill_stand.r', 'cooling_bed.l', 'strip', { id: 's1' }),
      L('cooling_bed.r', 'coil.l', 'line', { id: 'l7' }),
    ],
  },
  rows: [
    { id: 'blast_furnace', running: true, value: 1180 },
    { id: 'hot_metal_pot', running: true, value: 72 },
    { id: 'converter', running: true, value: 12 },
    { id: 'ladle', running: true, value: 84 },
    { id: 'arc_furnace', running: true, value: 58 },
    { id: 'overhead_crane', running: true, value: 40 },
    { id: 'caster', running: true },
    { id: 'reheating_furnace', running: true, value: 1240 },
    { id: 'mill_stand', running: true, status: 'critical', ack: false },
    { id: 'cooling_bed', running: true },
    { id: 'coil', running: false, value: 66 },
    { id: 'tap', running: true },
    { id: 'l1', running: true }, { id: 'l2', running: true }, { id: 'l3', running: true }, { id: 'l4', running: true },
    { id: 'l5', running: true }, { id: 'l6', running: true }, { id: 'l7', running: false }, { id: 's1', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Steel plant', [
  scene(SECTOR_SCENE, 9, 12),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Steel plant'), showSince: true }),
  P('mill', 'gauge', 'Mill load', 9, 3, 3, 3, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Mill stand', needle: true, $format: { unit: '%' },
    ranges: [{ to: 78, color: OK }, { from: 78, to: 92, color: WARN }, { from: 92, color: BAD }],
  }),
  P('speed', 'stat.sparkline', 'Casting speed', 9, 6, 3, 3, { series: 'sample.power' }, { label: 'Caster', showChange: 'percent', fill: 'gradient', $format: { unit: 'm/min', decimals: 1 } }),
  P('slab', 'stat.value', 'Slab temperature', 9, 9, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Slab at the mill', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 0 },
  }),
  P('power', 'chart.area', 'Arc furnace power', 0, 12, 8, 5, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'MW', decimals: 0 } }),
  P('alarms', 'data.feed', 'Alarms', 8, 12, 4, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
