// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-access.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "access" sample: the entrance of an apartment block. The street side (a sliding car-park gate, the door station, a
// keypad and a video panel on one controller), the entrance hall (magnetic lock, fingerprint reader, exit button, door
// closer and the door, held open), the lift lobby with its reader and the flats' intercoms on a riser, and the boiler room of
// the same block as a second zone. Signals run in `wire`, power in `cable`, hot water in `pipe`.

import type { BoardDocument } from '../settings/board';
import type { ScadaScene } from './scada-scenes';
import { BAD, board, OK, P, scene as scenePlacement, WARN } from './scada-board-kit';

type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });
const T = (x: number, y: number, text: string, extra: Elem = {}): Elem => ({ kind: 'text', x, y, text, ...extra });

/** Name above the symbol and the number beside it. */
const TOP: Elem = { labelPos: 't', valuePos: 'r' };
const R = (min: number, max: number, unit: string, decimals = 0): Elem => ({ min, max, unit, decimals });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.access',
  title: 'Building access',
  settings: {
    width: 1380, height: 900, scale: 1, background: 'dots',
    shapes: [
      T(20, 32, 'Apartment block entrance', { size: 'l', align: 'start' }),
      { kind: 'zone', x: 20, y: 60, w: 660, h: 400, text: 'Street side', tone: 'info' },
      { kind: 'zone', x: 700, y: 60, w: 660, h: 400, text: 'Entrance hall', tone: 'warning' },
      { kind: 'zone', x: 20, y: 480, w: 660, h: 400, text: 'Lift lobby and flats', tone: 'neutral' },
      { kind: 'zone', x: 700, y: 480, w: 660, h: 400, text: 'Boiler room', tone: 'neutral' },
    ],
    elements: [
      // Street side: the gate on its own supply, the door station, a keypad and a video panel on the access controller
      E('gate_car_park', 'access.gate.sliding', 100, 175, { label: 'Car-park gate', ...TOP, ...R(0, 100, '%') }),
      E('supply_gate', 'telecom.pdu', 100, 355, { label: 'Gate supply' }),
      E('door_station', 'access.intercom.door', 260, 175, { label: 'Door station', ...TOP }),
      E('keypad_service', 'access.keypad', 410, 175, { label: 'Service keypad', ...TOP }),
      E('video_panel', 'access.entry.video', 560, 175, { label: 'Video panel', ...TOP }),
      E('controller_access', 'building.bms.rack', 410, 355, { label: 'Access controller' }),
      // Entrance hall
      E('lock_magnetic', 'access.lock.magnetic', 770, 175, { label: 'Magnetic lock', ...TOP }),
      E('fingerprint_reader', 'access.fingerprint', 910, 175, { label: 'Fingerprint', ...TOP }),
      E('button_exit', 'access.button.exit', 1050, 175, { label: 'Exit button', ...TOP }),
      E('door_closer', 'access.closer', 1200, 175, { label: 'Door closer', ...TOP, ...R(0, 100, '%') }),
      E('controller_hall', 'building.bms.rack', 910, 355, { label: 'Hall controller' }),
      E('door_entrance', 'building.door.access', 1200, 355, { label: 'Entrance door · held open' }),
      // Lift lobby and flats
      E('lift', 'building.elevator', 100, 575, { label: 'Lift', ...TOP, ...R(0, 100, '%') }),
      E('reader_lift', 'building.reader', 240, 575, { label: 'Lift reader', ...TOP }),
      E('intercom_flat_1', 'access.intercom.apt', 400, 575, { label: 'Flat 1', ...TOP }),
      E('intercom_flat_2', 'access.intercom.apt', 520, 575, { label: 'Flat 2', ...TOP }),
      E('intercom_flat_3', 'access.intercom.apt', 640, 575, { label: 'Flat 3', ...TOP }),
      E('riser_intercom', 'telecom.patch', 520, 775, { label: 'Intercom riser' }),
      // Boiler room: the twin pump set feeds the boiler, which heats the block
      E('pump_set', 'hvac.pump.twin', 790, 680, { label: 'Pump set', medium: 'hot' }),
      E('boiler', 'hvac.boiler', 1000, 680, { label: 'Boiler', ...TOP, ...R(0, 100, '°C'), medium: 'hot' }),
      E('radiator_stair', 'hvac.radiator', 1200, 680, { label: 'Stair heating', medium: 'hot' }),
    ],
    links: [
      L('gate_car_park.b', 'supply_gate.t', 'cable', { id: 'pwg' }),
      L('door_station.b', 'controller_access.t', 'wire', { id: 'sg' }),
      L('keypad_service.b', 'controller_access.t', 'wire', { id: 'sg' }),
      L('video_panel.b', 'controller_access.t', 'wire', { id: 'sg' }),
      L('lock_magnetic.b', 'controller_hall.t', 'wire', { id: 'hl' }),
      L('fingerprint_reader.b', 'controller_hall.t', 'wire', { id: 'hl' }),
      L('button_exit.b', 'controller_hall.t', 'wire', { id: 'hl' }),
      L('intercom_flat_1.b', 'riser_intercom.t', 'wire', { id: 'rzl' }),
      L('intercom_flat_2.b', 'riser_intercom.t', 'wire', { id: 'rzl' }),
      L('intercom_flat_3.b', 'riser_intercom.t', 'wire', { id: 'rzl' }),
      L('pump_set.r', 'boiler.l', 'pipe', { id: 'ph', medium: 'hot' }),
      L('boiler.r', 'radiator_stair.l', 'pipe', { id: 'bh', medium: 'hot' }),
    ],
  },
  rows: [
    { id: 'gate_car_park', running: true, value: 35, label: 'Gate · opening' },
    { id: 'supply_gate', running: true },
    { id: 'door_station', running: true, label: 'Door station · call' },
    { id: 'keypad_service', running: false },
    { id: 'video_panel', running: false },
    { id: 'controller_access', running: true },
    { id: 'lock_magnetic', running: true },
    { id: 'fingerprint_reader', running: true, label: 'Fingerprint · reading' },
    { id: 'button_exit', running: false },
    { id: 'door_closer', running: false, value: 30 },
    { id: 'controller_hall', running: true },
    { id: 'door_entrance', running: true, status: 'warning', label: 'Entrance door · held open' },
    { id: 'lift', running: true, value: 40 },
    { id: 'reader_lift', running: true },
    { id: 'intercom_flat_1', running: false },
    { id: 'intercom_flat_2', running: true, label: 'Flat 2 · ringing' },
    { id: 'intercom_flat_3', running: false },
    { id: 'riser_intercom', running: true },
    { id: 'pump_set', running: true },
    { id: 'boiler', running: true, value: 72 },
    { id: 'radiator_stair', running: true },
    { id: 'pwg', running: true }, { id: 'sg', running: true }, { id: 'hl', running: true }, { id: 'rzl', running: true },
    { id: 'ph', running: true }, { id: 'bh', running: true },
  ],
};

/** The board: the block beside the controls: an "Open the street door" button, the lock and gate switches, the boiler set point, the door events and the entries counted today. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Building access', [
  scenePlacement(SECTOR_SCENE, 9, 15),
  P('status', 'state', 'Entrance door', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Entrance door',
    states: [
      { match: 'RUNNING', label: 'Held open', color: WARN, icon: 'fas fa-door-open', pulse: true },
      { match: 'STOPPED', label: 'Locked', color: OK, icon: 'fas fa-lock' },
      { match: 'IDLE', label: 'Closed', color: BAD, icon: 'fas fa-door-closed' },
    ],
    showSince: true,
  }),
  P('open', 'control.button', 'Open the street door', 9, 3, 3, 2, {}, { label: 'Open the street door', icon: 'fas fa-door-open', fullWidth: true }),
  P('lock', 'control.switch', 'Magnetic lock', 9, 5, 3, 2, { value: 'sample.pump' }, { label: 'Magnetic lock', icon: 'fas fa-lock', stateDisplay: 'pill' }),
  P('gate', 'control.switch', 'Car-park gate', 9, 7, 3, 2, { value: 'sample.pump' }, { label: 'Car-park gate', icon: 'fas fa-car', stateDisplay: 'pill' }),
  P('boiler', 'control.setpoint', 'Boiler water temperature', 9, 9, 3, 3, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Boiler water', min: 40, max: 90, step: 1, $format: { unit: '°C', decimals: 0 },
  }),
  P('entries', 'stat.value', 'Entries today', 9, 12, 3, 3, { value: 'sample.cpu', compare: 'sample.temperature.yesterday' }, {
    label: 'Entries today', icon: 'fas fa-person-walking-arrow-right', increaseIs: 'good', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '', decimals: 0 },
  }),
  P('events', 'data.feed', 'Door events', 0, 15, 12, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
