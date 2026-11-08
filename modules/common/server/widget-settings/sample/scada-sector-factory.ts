// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-factory.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "factory" sector sample: one process diagram with its readings and the board built around it (pure data).
// A packaging line: a press feeds a belt that turns into the infeed, a robot hands the product on, a camera inspects
// it, a case packer and a lift box it, a palletiser stacks the cases and an AGV takes the pallet away. A controller
// is wired to the machines; product flow is drawn with single lines.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const WIRE = { medium: 'custom', mediumColor: 'var(--info)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.factory',
  title: 'Packaging line',
  settings: {
    width: 1180, height: 400, scale: 0.65, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Packaging line 3', size: 'l', align: 'start' },
      { kind: 'text', x: 106, y: 138, text: 'Press', size: 's', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 240, h: 262, text: 'Forming and infeed' },
      { kind: 'zone', x: 268, y: 60, w: 100, h: 262, text: 'Robot cell' },
      { kind: 'zone', x: 376, y: 60, w: 120, h: 262, text: 'Inspection' },
      { kind: 'zone', x: 504, y: 60, w: 192, h: 262, text: 'Packing' },
      { kind: 'zone', x: 704, y: 60, w: 410, h: 262, text: 'Palletising and transport', tone: 'info' },
    ],
    elements: [
      E('press', 'factory.press', 70, 130, { label: 'Press', labelPos: 'n' }),
      E('conveyor_press', 'factory.conveyor', 70, 197.5, { label: 'Press conveyor', labelPos: 'n', turn: '90' }),
      E('conveyor_curve', 'factory.conveyor.curve', 70, 262.5, { label: 'Curve conveyor', labelPos: 'n', turn: '180' }),
      E('conveyor_infeed', 'factory.conveyor', 167.5, 262.5, { label: 'Infeed conveyor', length: '2', labelPos: 'n' }),
      E('robot', 'factory.robot', 310, 262.5, { label: 'Robot' }),
      E('camera_vision', 'factory.camera', 440, 262.5, { label: 'Vision' }),
      E('case_packer', 'factory.packer', 550, 262.5, { label: 'Case packer' }),
      E('case_lift', 'factory.lift', 650, 262.5, { label: 'Case lift' }),
      E('conveyor_outfeed', 'factory.conveyor', 750, 262.5, { label: 'Outfeed conveyor', labelPos: 'n' }),
      E('palletiser', 'factory.stacker', 850, 262.5, { label: 'Palletiser' }),
      E('pallet', 'factory.pallet', 950, 262.5, { label: 'Pallet', showValue: false, max: 100 }),
      E('guided_vehicle', 'factory.agv', 1060, 262.5, { label: 'AGV' }),
      E('line_controller', 'rtu', 550, 150, { label: 'Line controller', labelPos: 't' }),
    ],
    links: [
      L('conveyor_infeed.r', 'robot.l', 'line', { id: 'conveyor_infeed' }),
      L('robot.r', 'camera_vision.l', 'line', { id: 'robot' }),
      L('camera_vision.r', 'case_packer.l', 'line', { id: 'camera_vision' }),
      L('case_packer.r', 'case_lift.l', 'line', { id: 'case_packer' }),
      L('case_lift.r', 'conveyor_outfeed.l', 'line', { id: 'case_lift' }),
      L('conveyor_outfeed.r', 'palletiser.l', 'line', { id: 'conveyor_outfeed' }),
      L('pallet.r', 'guided_vehicle.l', 'line', { id: 'pallet' }),
      L('line_controller.l', 'robot.t', 'wire', { id: 'line_controller', ...WIRE }),
      L('line_controller.l', 'camera_vision.t', 'wire', { id: 'line_controller', ...WIRE }),
      L('line_controller.b', 'case_packer.t', 'wire', { id: 'line_controller', ...WIRE }),
      L('line_controller.r', 'case_lift.t', 'wire', { id: 'line_controller', ...WIRE }),
      L('line_controller.r', 'palletiser.t', 'wire', { id: 'line_controller', ...WIRE }),
    ],
  },
  rows: [
    { id: 'press', running: true, label: 'Press' },
    { id: 'conveyor_press', running: true },
    { id: 'conveyor_curve', running: true },
    { id: 'conveyor_infeed', running: true },
    { id: 'robot', running: true, label: 'Robot' },
    { id: 'camera_vision', running: true, label: 'Vision' },
    { id: 'case_packer', running: true, status: 'warning', label: 'Case packer' },
    { id: 'case_lift', running: true },
    { id: 'conveyor_outfeed', running: true },
    { id: 'palletiser', running: true },
    { id: 'pallet', running: true, value: 67, label: 'Pallet' },
    { id: 'guided_vehicle', running: false, label: 'AGV' },
    { id: 'line_controller', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Packaging line', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Line status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Line 3'), showSince: true }),
  P('oee', 'gauge', 'OEE', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'OEE', needle: true, $format: { unit: '%' },
    ranges: [{ to: 50, color: BAD }, { from: 50, to: 75, color: WARN }, { from: 75, color: OK }],
  }),
  P('rate', 'stat.sparkline', 'Throughput', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Cases per minute', showChange: 'percent', fill: 'gradient', $format: { unit: 'cpm', decimals: 0 } }),
  P('cell', 'control.switch', 'Robot cell', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Robot cell enabled', icon: 'fas fa-robot', stateDisplay: 'pill' }),
  P('speed', 'chart.line', 'Belt speed', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'm/min', decimals: 1 } }),
  P('events', 'data.feed', 'Line events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
