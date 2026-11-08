// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-telecom.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "telecom" sector sample: a small data room (carrier fibre, modem, firewall, core switch, gateway router, racks, a
// server, UPS, power distribution and precision cooling) with an uplink to an antenna mast and two branch sites, with
// its readings, and the board built around it (pure data). Data is `line` and `wire`, power is `cable`.

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
  source: 'sample.scada.telecom',
  title: 'Network and data room',
  settings: {
    width: 1300, height: 660, scale: 1, background: 'dots',
    shapes: [
      T(20, 32, 'Network and data room', { size: 'l', align: 'start' }),
      { kind: 'zone', x: 20, y: 60, w: 760, h: 380, text: 'Data room · network, compute and cooling' },
      { kind: 'zone', x: 20, y: 450, w: 760, h: 150, text: 'Data room · power' },
      { kind: 'zone', x: 810, y: 60, w: 430, h: 540, text: 'Uplink and branch sites' },
      T(312, 408, 'Rack A', { size: 's', align: 'end' }),
      T(432, 408, 'Rack B', { size: 's', align: 'end' }),
      T(552, 408, 'Server', { size: 's', align: 'end' }),
      T(682, 408, 'Cooling unit', { size: 's', align: 'end' }),
      T(36, 106, 'Carrier fibre', { size: 's', align: 'start' }),
    ],
    elements: [
      // The network row
      E('fibre_panel', 'telecom.fiber', 80, 160, { label: 'Fibre panel' }),
      E('modem', 'telecom.modem', 200, 160, { label: 'Modem' }),
      E('firewall', 'telecom.firewall', 320, 160, { label: 'Firewall' }),
      E('switch_core', 'telecom.switch', 440, 160, { label: 'Core switch', labelPos: 't' }),
      E('gateway', 'telecom.router', 560, 160, { label: 'Gateway' }),
      // Compute and cooling
      E('rack_1', 'telecom.rack', 320, 340, { label: 'Rack 1', labelPos: 'n' }),
      E('rack_2', 'telecom.rack', 440, 340, { label: 'Rack 2', labelPos: 'n' }),
      E('server', 'telecom.server', 560, 340, { label: 'Server', labelPos: 'n' }),
      E('crac_unit', 'telecom.crac', 690, 340, { label: 'CRAC unit', labelPos: 'n' }),
      // Power
      E('mains', 'sld.grid', 80, 510, { label: 'Mains' }),
      E('uninterruptible_power_supply', 'telecom.ups', 200, 510, { label: 'UPS', min: 0, max: 100 }),
      E('pdu_a', 'telecom.pdu', 320, 510, { label: 'PDU A' }),
      E('pdu_b', 'telecom.pdu', 440, 510, { label: 'PDU B' }),
      E('pdu_c', 'telecom.pdu', 560, 510, { label: 'PDU C' }),
      // Uplink: mast, two branch routers and their access points
      E('antenna_mast', 'telecom.tower', 960, 160, { label: 'Antenna mast', labelPos: 't' }),
      E('router_branch_a', 'telecom.router', 1060, 270, { label: 'Branch router A' }),
      E('access_point_a', 'telecom.access.point', 1160, 350, { label: 'Access point A' }),
      E('router_branch_b', 'telecom.router', 1060, 460, { label: 'Branch router B' }),
      E('access_point_b', 'telecom.access.point', 1160, 530, { label: 'Access point B' }),
    ],
    links: [
      // Data
      L('fibre_panel.r', 'modem.l', 'line', { id: 'lan' }),
      L('modem.r', 'firewall.l', 'line', { id: 'lan' }),
      L('firewall.r', 'switch_core.l', 'line', { id: 'lan' }),
      L('switch_core.r', 'gateway.l', 'line', { id: 'lan' }),
      L('switch_core.b:0.3', 'rack_1.t', 'line', { id: 'lan', mid: 255 }),
      L('switch_core.b:0.5', 'rack_2.t', 'line', { id: 'lan' }),
      L('switch_core.b:0.7', 'server.t', 'line', { id: 'lan', mid: 255 }),
      L('gateway.r', 'antenna_mast.l', 'line', { id: 'lan' }),
      L('antenna_mast.b', 'router_branch_a.l', 'wire', { id: 'rf1' }),
      L('antenna_mast.b', 'router_branch_b.l', 'wire', { id: 'rf2' }),
      L('router_branch_a.r', 'access_point_a.t', 'line', { id: 'lan' }),
      L('router_branch_b.r', 'access_point_b.t', 'line', { id: 'lan' }),
      // Power
      L('mains.r', 'uninterruptible_power_supply.l', 'cable', { id: 'pw1' }),
      L('uninterruptible_power_supply.r', 'pdu_a.l', 'cable', { id: 'pw2' }),
      L('pdu_a.r', 'pdu_b.l', 'cable', { id: 'pw2' }),
      L('pdu_b.r', 'pdu_c.l', 'cable', { id: 'pw2' }),
      L('pdu_a.t', 'rack_1.b', 'cable', { id: 'pw2' }),
      L('pdu_b.t', 'rack_2.b', 'cable', { id: 'pw2' }),
      L('pdu_c.t', 'server.b', 'cable', { id: 'pw2' }),
      L('pdu_c.r', 'crac_unit.b', 'cable', { id: 'pw2' }),
    ],
  },
  rows: merge(
    on('fibre_panel', 'modem', 'firewall', 'switch_core', 'gateway', 'rack_1', 'rack_2', 'server', 'crac_unit', 'mains', 'uninterruptible_power_supply', 'pdu_a', 'pdu_b', 'pdu_c', 'antenna_mast', 'router_branch_a', 'router_branch_b', 'access_point_a'),
    on('lan', 'rf1', 'pw1'),
    [
      // The UPS carries the load on battery: a warning on it and on the feed it gives.
      { id: 'uninterruptible_power_supply', status: 'warning', value: 58 },
      { id: 'pw2', running: true, status: 'warning' },
      // The second branch has lost its access point and its radio link.
      { id: 'rf2', running: true, status: 'critical' },
      { id: 'access_point_b', running: false, status: 'critical' },
      { id: 'crac_unit', running: true, value: 22 },
    ],
  ),
};

/** The board: the diagram with an uplink status, the cold-aisle temperature, the core switch load and the traffic beside it. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Network and data room', [
  scenePlacement(SECTOR_SCENE, 9, 10),
  P('status', 'state', 'Uplink status', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Carrier uplink',
    states: [
      { match: 'RUNNING', label: 'Up', color: OK, icon: 'fas fa-globe', pulse: true },
      { match: 'STOPPED', label: 'Down', color: BAD, icon: 'fas fa-circle-xmark' },
      { match: 'IDLE', label: 'Backup link', color: WARN, icon: 'fas fa-tower-cell' },
    ],
    showSince: true,
  }),
  P('temp', 'stat.value', 'Cold-aisle temperature', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Cold aisle', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('cpu', 'gauge', 'Core switch load', 9, 6, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Switch CPU', needle: true, $format: { unit: '%' },
    ranges: [{ to: 60, color: OK }, { from: 60, to: 85, color: WARN }, { from: 85, color: BAD }],
  }),
  P('traffic', 'chart.line', 'Uplink traffic', 0, 10, 12, 5, { series: 'sample.power' }, { legendValues: ['latest', 'avg'], $format: { unit: 'Mbit/s' } }),
]);
