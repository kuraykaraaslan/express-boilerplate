// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-home.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "home" sector sample: a house cut into rooms (network closet, living room, home office, entrance) with the
// consumer devices in them, their readings, and the board built around it (pure data). Ethernet is `line`, the wireless
// backhaul between the mesh nodes is `wire`, power is `cable`. Mirrored devices put their data port on the other side.

import type { BoardDocument } from '../settings/board';
import type { ScadaScene } from './scada-scenes';
import { BAD, board, OK, P, scene as scenePlacement, WARN } from './scada-board-kit';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });
const T = (x: number, y: number, text: string, extra: Elem = {}): Elem => ({ kind: 'text', x, y, text, ...extra });

/** Rows merged by id: a later row adds to an earlier one. */
const merge = (...parts: Row[][]): Row[] => {
  const out: Row[] = [];
  for (const r of parts.flat()) {
    const i = out.findIndex((x) => x.id === r.id);
    if (i >= 0) out[i] = { ...out[i], ...r }; else out.push(r);
  }
  return out;
};
const on = (...ids: string[]): Row[] => ids.map((id) => ({ id, running: true }));

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.home',
  title: 'Home electronics',
  settings: {
    width: 1380, height: 860, scale: 1, background: 'dots',
    shapes: [
      T(20, 32, 'Home electronics', { size: 'l', align: 'start' }),
      { kind: 'zone', x: 20, y: 60, w: 640, h: 380, text: 'Network closet', tone: 'neutral' },
      { kind: 'zone', x: 680, y: 60, w: 680, h: 380, text: 'Living room', tone: 'info' },
      { kind: 'zone', x: 20, y: 460, w: 640, h: 380, text: 'Home office', tone: 'neutral' },
      { kind: 'zone', x: 680, y: 460, w: 680, h: 380, text: 'Entrance', tone: 'warning' },
    ],
    elements: [
      // Network closet: data row (modem, router, NAS, hub) and its power row
      E('modem_fibre', 'telecom.modem', 90, 175, { label: 'Fibre modem' }),
      E('router_wifi', 'home.router', 230, 175, { label: 'Wi-Fi router', labelPos: 't' }),
      E('network_storage', 'home.nas', 370, 175, { label: 'NAS', labelPos: 't', showValue: false, min: 0, max: 100, unit: '%', decimals: 0 }),
      E('smart_home_hub', 'home.hub', 510, 175, { label: 'Smart-home hub', labelPos: 't' }),
      E('mains', 'sld.grid', 90, 355, { label: 'Mains' }),
      E('battery_backup', 'home.ups', 230, 355, { label: 'Battery backup', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('power_strip', 'telecom.pdu', 370, 355, { label: 'Power strip' }),
      // Living room
      E('television', 'home.tv', 800, 175, { label: 'TV', mirror: true }),
      E('game_console', 'home.console', 800, 355, { label: 'Game console', mirror: true }),
      E('mesh_living_room', 'home.mesh', 1010, 265, { label: 'Mesh node · living room', labelPos: 't' }),
      E('smart_speaker', 'home.speaker.smart', 1010, 112, { label: 'Smart speaker', mirror: true }),
      E('soundbar', 'home.soundbar', 1220, 175, { label: 'Soundbar' }),
      E('set_top_box', 'home.settop', 1220, 355, { label: 'Set-top box' }),
      // Home office
      E('desktop', 'home.desktop', 110, 575, { label: 'Desktop', mirror: true }),
      E('laptop', 'home.laptop', 110, 755, { label: 'Laptop', mirror: true }),
      E('mesh_office', 'home.mesh', 300, 665, { label: 'Mesh node · office' }),
      E('printer', 'home.printer', 490, 575, { label: 'Printer' }),
      E('plug_printer', 'home.plug.smart', 600, 575, { label: 'Printer plug', min: 0, max: 100, unit: ' W', decimals: 0 }),
      E('monitor_second', 'home.monitor', 490, 755, { label: 'Second monitor' }),
      // Entrance
      E('plug_doorbell', 'home.plug.smart', 740, 575, { label: 'Doorbell supply', min: 0, max: 100, unit: ' W', decimals: 0 }),
      E('video_doorbell', 'home.doorbell', 870, 575, { label: 'Video doorbell', mirror: true }),
      E('camera_porch', 'home.camera.security', 870, 755, { label: 'Porch camera', mirror: true }),
      E('mesh_hall', 'home.mesh', 1040, 665, { label: 'Mesh node · hall' }),
      E('smart_display', 'home.display.smart', 1210, 575, { label: 'Smart display' }),
      E('camera_garden', 'home.camera.security', 1210, 755, { label: 'Garden camera' }),
    ],
    links: [
      // Network closet
      L('modem_fibre.r', 'router_wifi.l', 'line', { id: 'lan' }),
      L('router_wifi.r', 'network_storage.l', 'line', { id: 'lan' }),
      L('network_storage.r', 'smart_home_hub.l', 'line', { id: 'lan' }),
      // Uplink to the living room, then the room's devices
      L('smart_home_hub.r', 'mesh_living_room.l', 'line', { id: 'lan', mid: 700 }),
      L('television.r', 'mesh_living_room.l', 'line', { id: 'lan' }),
      L('game_console.r', 'mesh_living_room.l', 'line', { id: 'lan' }),
      L('smart_speaker.r', 'mesh_living_room.r', 'line', { id: 'lan', mid: 1115 }),
      L('mesh_living_room.r', 'soundbar.l', 'line', { id: 'lan' }),
      L('mesh_living_room.r', 'set_top_box.l', 'line', { id: 'lan' }),
      // Wireless backhaul to the other two nodes
      L('mesh_living_room.b:0.3', 'mesh_office.t', 'wire', { id: 'bh1', mid: 450 }),
      L('mesh_living_room.b:0.7', 'mesh_hall.t', 'wire', { id: 'bh2' }),
      // Office
      L('desktop.r', 'mesh_office.l', 'line', { id: 'lan' }),
      L('laptop.r', 'mesh_office.l', 'line', { id: 'lan' }),
      L('mesh_office.r', 'printer.l', 'line', { id: 'lan' }),
      L('mesh_office.r', 'monitor_second.l', 'line', { id: 'lan' }),
      // Entrance
      L('video_doorbell.r', 'mesh_hall.l', 'line', { id: 'lan' }),
      L('camera_porch.r', 'mesh_hall.l', 'line', { id: 'lan' }),
      L('mesh_hall.r', 'smart_display.l', 'line', { id: 'lan' }),
      L('mesh_hall.r', 'camera_garden.l', 'line', { id: 'lan' }),
      // Power
      L('mains.r', 'battery_backup.l', 'cable', { id: 'pw' }),
      L('battery_backup.t', 'router_wifi.b', 'cable', { id: 'pw' }),
      L('battery_backup.r', 'power_strip.l', 'cable', { id: 'pw' }),
      L('power_strip.t', 'network_storage.b', 'cable', { id: 'pw' }),
      L('power_strip.r', 'smart_home_hub.b', 'cable', { id: 'pw' }),
      L('printer.r', 'plug_printer.l', 'cable', { id: 'pw2' }),
      L('plug_doorbell.r', 'video_doorbell.l', 'cable', { id: 'pw2' }),
    ],
  },
  rows: merge(
    on('modem_fibre', 'router_wifi', 'network_storage', 'smart_home_hub', 'mains', 'battery_backup', 'power_strip', 'television', 'mesh_living_room', 'smart_speaker', 'soundbar', 'set_top_box', 'desktop', 'laptop', 'mesh_office', 'printer', 'plug_printer', 'plug_doorbell', 'camera_porch', 'mesh_hall', 'smart_display', 'camera_garden'),
    on('lan', 'pw', 'pw2', 'bh1'),
    [
      // The NAS is nearly full; the hall node hears the living-room node badly.
      { id: 'network_storage', running: true, value: 88, status: 'warning', label: 'NAS · 88 % full' },
      { id: 'battery_backup', running: true, value: 72 },
      { id: 'set_top_box', running: true, value: 7 },
      { id: 'plug_printer', running: true, value: 14 },
      { id: 'plug_doorbell', running: true, value: 3 },
      { id: 'mesh_hall', running: true, status: 'warning' },
      { id: 'bh2', running: true, status: 'warning' },
      // The console and the second monitor sleep, the doorbell waits for a visitor.
      { id: 'game_console', running: false },
      { id: 'monitor_second', running: false },
      { id: 'video_doorbell', running: false },
    ],
  ),
};

/** The board: the house with the router state, the free storage, two switches, the throughput and the event log beside it. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Home electronics', [
  scenePlacement(SECTOR_SCENE, 9, 13),
  P('storage', 'gauge', 'Storage used', 9, 0, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'NAS used', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 85, color: WARN }, { from: 85, color: BAD }],
  }),
  P('status', 'state', 'Router status', 9, 4, 3, 3, { value: 'sample.state' }, {
    label: 'Internet',
    states: [
      { match: 'RUNNING', label: 'Online', color: OK, icon: 'fas fa-wifi', pulse: true },
      { match: 'STOPPED', label: 'Offline', color: BAD, icon: 'fas fa-circle-xmark' },
      { match: 'IDLE', label: 'Backup link', color: WARN, icon: 'fas fa-signal' },
    ],
    showSince: true,
  }),
  P('guest', 'control.switch', 'Guest Wi-Fi', 9, 7, 3, 3, { value: 'sample.pump' }, { label: 'Guest Wi-Fi', icon: 'fas fa-wifi', stateDisplay: 'pill' }),
  P('porch', 'control.switch', 'Porch light', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Porch light', icon: 'fas fa-lightbulb', stateDisplay: 'pill' }),
  P('traffic', 'chart.line', 'Network throughput', 0, 13, 8, 5, { series: 'sample.power' }, { legendValues: ['latest', 'avg'], $format: { unit: 'Mbit/s', decimals: 0 } }),
  P('events', 'data.feed', 'Home events', 8, 13, 4, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 4 }),
]);
