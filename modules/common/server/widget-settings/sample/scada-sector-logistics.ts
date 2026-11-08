// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-logistics.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "logistics" sector sample: one process diagram with its readings and the board built around it (pure data).
// A small distribution centre: goods come in at dock 1 onto a belt, are weighed and labelled, and run through a tilt-tray
// sorter onto two lanes (lane 3 is full and blocked); the belt ends at an AS/RS aisle and a picking robot. Below, the
// dock 2 and yard (truck and forklift) and the reserve storage (pallet shuttle and a pallet rack). Product flow is drawn
// with the existing belts and single lines.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.logistics',
  title: 'Warehouse and logistics',
  settings: {
    width: 1220, height: 520, scale: 0.8, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Distribution centre', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 62, w: 425, h: 233, text: 'Inbound' },
      { kind: 'zone', x: 453, y: 62, w: 355, h: 233, text: 'Sortation', tone: 'warning' },
      { kind: 'zone', x: 816, y: 62, w: 384, h: 233, text: 'Automated storage' },
      { kind: 'zone', x: 20, y: 307, w: 545, h: 195, text: 'Dock 2 and yard' },
      { kind: 'zone', x: 573, y: 307, w: 627, h: 195, text: 'Reserve storage' },
    ],
    elements: [
      E('dock_1', 'logistics.door.dock', 65, 215, { label: 'Dock 1', max: 100 }),
      E('conveyor_dock_1', 'factory.conveyor', 205, 215, { label: 'Dock 1 conveyor', length: '2', labelPos: 'n' }),
      E('pallet_scale', 'logistics.scale.pallet', 325, 215, { label: 'Pallet scale', unit: 'kg', decimals: 0 }),
      E('labeller', 'logistics.printer.label', 405, 215, { label: 'Labeller' }),
      E('sorter', 'logistics.sorter', 501, 215, { label: 'Sorter' }),
      E('lane_2', 'factory.conveyor', 637, 215, { length: '2', label: 'Lane 2', labelPos: 'b' }),
      E('lane_3', 'factory.conveyor', 757, 215, { label: 'Lane 3', labelPos: 'b' }),
      E('asrs_aisle_1', 'logistics.crane.asrs', 880, 215, { label: 'AS/RS aisle 1' }),
      E('picking_robot', 'logistics.picker.robot', 1000, 215, { label: 'Picking robot' }),
      E('controller', 'rtu', 1120, 215, { label: 'Controller' }),
      E('dock_2', 'logistics.door.dock', 65, 410, { label: 'Dock 2', max: 100 }),
      E('truck_14', 'logistics.truck', 210, 410, { label: 'Truck 14' }),
      E('forklift_3', 'logistics.forklift', 380, 410, { label: 'Forklift 3' }),
      E('shuttle_lane_7', 'logistics.shuttle', 700, 410, { label: 'Shuttle lane 7' }),
      E('rack_2', 'logistics.rack', 850, 410, { label: 'Rack 2', max: 100 }),
      E('rack_3', 'logistics.rack', 960, 410, { label: 'Rack 3', max: 100 }),
    ],
    links: [
      L('dock_1.r', 'conveyor_dock_1.l', 'line', { id: 'dock_1' }),
      L('conveyor_dock_1.r', 'pallet_scale.l', 'line', { id: 'conveyor_dock_1' }),
      L('lane_3.r', 'asrs_aisle_1.l', 'line', { id: 'lane_3' }),
      L('asrs_aisle_1.r', 'picking_robot.l', 'line', { id: 'asrs_aisle_1' }),
      L('picking_robot.r', 'controller.l', 'line', { id: 'picking_robot' }),
    ],
  },
  rows: [
    { id: 'dock_1', running: true, value: 100, label: 'Dock 1' },
    { id: 'conveyor_dock_1', running: true },
    { id: 'pallet_scale', running: true, value: 612 },
    { id: 'labeller', running: true },
    { id: 'sorter', running: true, label: 'Sorter' },
    { id: 'lane_2', running: true, label: 'Lane 2' },
    { id: 'lane_3', running: false, status: 'warning', label: 'Lane 3 blocked' },
    { id: 'asrs_aisle_1', running: true },
    { id: 'picking_robot', running: true },
    { id: 'controller', running: true },
    { id: 'dock_2', running: false, value: 0, label: 'Dock 2' },
    { id: 'truck_14', running: false },
    { id: 'forklift_3', running: true },
    { id: 'shuttle_lane_7', running: true },
    { id: 'rack_2', running: false, value: 66, label: 'Rack 2' },
    { id: 'rack_3', running: true, value: 33, label: 'Rack 3' },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Warehouse and logistics', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Sorter status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Sorter 1'), showSince: true }),
  P('fill', 'gauge', 'Storage fill', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Storage fill', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('rate', 'stat.sparkline', 'Parcels sorted', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Parcels per hour', showChange: 'percent', fill: 'gradient', $format: { unit: 'parcels/h', decimals: 0 } }),
  P('lane', 'control.switch', 'Lane 3', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Lane 3 released', icon: 'fas fa-boxes-stacked', stateDisplay: 'pill' }),
  P('thru', 'chart.line', 'Throughput', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'pallets/h', decimals: 0 } }),
  P('events', 'data.feed', 'Warehouse events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
