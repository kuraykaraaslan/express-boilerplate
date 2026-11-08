// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-building.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "building" sector sample: one process diagram with its readings and the board built around it (pure data).
// The plant room and risers of an office building: a fire water tank, a fire pump set and the sprinkler riser; the standby
// generator and the automatic transfer switch next to the mains incomer, with a sub-meter on the load; and the floors
// above: a lift, an escalator, the fire alarm panel (two zones in alarm), lighting, a door with its card reader and a
// turnstile. Water runs in pipes, power in cables.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.building',
  title: 'Building services',
  settings: {
    width: 1220, height: 520, scale: 0.8, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Office building, plant room and floors', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 725, h: 215, text: 'Fire water', tone: 'info' },
      { kind: 'zone', x: 20, y: 290, w: 725, h: 195, text: 'Power and standby supply', tone: 'warning' },
      { kind: 'zone', x: 760, y: 60, w: 440, h: 215, text: 'Floors' },
      { kind: 'zone', x: 760, y: 290, w: 440, h: 195, text: 'Access control', tone: 'info' },
    ],
    elements: [
      E('fire_tank', 'building.tank.fire', 190, 150, { label: 'Fire tank', labelPos: 't', max: 100, valuePos: 'r', medium: 'water' }),
      E('fire_pump', 'building.pump.fire', 340, 205, { label: 'Fire pump', medium: 'water' }),
      E('sprinkler_riser', 'building.riser.sprinkler', 500, 150, { label: 'Sprinkler riser', labelPos: 't', medium: 'water' }),
      E('standby_generator', 'building.generator.standby', 160, 345, { label: 'Standby generator' }),
      E('mains_incomer', 'breaker', 330, 410, { label: 'Mains incomer' }),
      E('transfer_switch', 'building.ats', 450, 410, { label: 'Transfer switch' }),
      E('sub_meter', 'building.meter.sub', 570, 410, { label: 'Sub-meter', unit: 'kW', decimals: 0 }),
      E('bms_rack', 'building.bms.rack', 680, 410, { label: 'BMS rack' }),
      E('lift_1', 'building.elevator', 810, 140, { label: 'Lift 1', max: 100 }),
      E('escalator', 'building.escalator', 930, 150, { label: 'Escalator' }),
      E('fire_panel', 'building.panel.fire', 1050, 140, { label: 'Fire panel', max: 8 }),
      E('lights', 'building.lighting.group', 1150, 150, { label: 'Lights', max: 100 }),
      E('door_server_room', 'building.door.access', 820, 395, { label: 'Server room' }),
      E('card_reader', 'building.reader', 925, 395, { label: 'Card reader' }),
      E('lobby_gate', 'building.turnstile', 1030, 395, { label: 'Lobby gate' }),
    ],
    links: [
      L('fire_tank.b', 'fire_pump.l', 'pipe', { id: 'fire_tank', medium: 'water' }),
      L('fire_pump.r', 'sprinkler_riser.b', 'pipe', { id: 'fire_pump', medium: 'water' }),
      L('standby_generator.r', 'transfer_switch.t', 'cable', { id: 'standby_generator' }),
      L('mains_incomer.r', 'transfer_switch.l', 'cable', { id: 'mains_incomer' }),
      L('transfer_switch.r', 'sub_meter.l', 'cable', { id: 'transfer_switch' }),
      L('sub_meter.r', 'bms_rack.l', 'cable', { id: 'sub_meter' }),
    ],
  },
  rows: [
    { id: 'fire_tank', running: true, value: 82, label: 'Fire tank' },
    { id: 'fire_pump', running: true },
    { id: 'sprinkler_riser', running: true },
    { id: 'standby_generator', running: false },
    { id: 'mains_incomer', running: true },
    { id: 'transfer_switch', running: false },
    { id: 'sub_meter', running: true, value: 184 },
    { id: 'bms_rack', running: true },
    { id: 'lift_1', running: true, value: 62, label: 'Lift 1' },
    { id: 'escalator', running: true },
    { id: 'fire_panel', running: true, value: 2, status: 'critical', label: 'Fire panel' },
    { id: 'lights', running: true, value: 70 },
    { id: 'door_server_room', running: false, label: 'Server room' },
    { id: 'card_reader', running: true },
    { id: 'lobby_gate', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Building services', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Building status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Office block'), showSince: true }),
  P('tank', 'gauge', 'Fire tank level', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Fire tank', needle: true, $format: { unit: '%' },
    ranges: [{ to: 50, color: BAD }, { from: 50, to: 80, color: WARN }, { from: 80, color: OK }],
  }),
  P('load', 'stat.sparkline', 'Building load', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Building load', showChange: 'percent', fill: 'gradient', $format: { unit: 'kW', decimals: 0 } }),
  P('genauto', 'control.switch', 'Standby generator', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Generator auto start', icon: 'fas fa-bolt', stateDisplay: 'pill' }),
  P('temp', 'chart.line', 'Riser room temperature', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Building events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
