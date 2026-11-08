// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-power.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "power" sector sample: a plant substation as a single-line diagram (utility incomer, an 11 kV switchboard, two
// transformers, two 400 V boards with a drive and motor, a capacitor bank, an EV charging bay, a building load and a
// solar tie) with its readings, and the board built around it (pure data).

import type { BoardDocument } from '../settings/board';
import type { ScadaScene } from './scada-scenes';
import { BAD, board, OK, P, scene as scenePlacement, WARN } from './scada-board-kit';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });
const T = (x: number, y: number, text: string, extra: Elem = {}): Elem => ({ kind: 'text', x, y, text, ...extra });

// A turned breaker in a feeder, no name (the line says what it is).
const CB = (id: string, x: number, y: number, extra: Elem = {}): Elem => E(id, 'sld.breaker', x, y, { turn: '90', labelPos: 'n', ...extra });

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
  source: 'sample.scada.power',
  title: 'Plant substation',
  settings: {
    width: 1260, height: 1020, scale: 0.9, background: 'dots',
    // Rules: a breaker that reports critical shows critical and blinks; a drive that warns blinks too and says so.
    rules: [
      { target: 'breaker_incomer', key: 'status', op: 'eq', value: 'critical', state: 'critical', blink: 'true' },
      { target: 'drive_vfd', key: 'status', op: 'eq', value: 'warning', blink: 'true', label: 'Drive: check' },
    ],
    shapes: [
      T(20, 32, 'Plant substation · single-line diagram', { size: 'l', align: 'start' }),
      T(262, 505, 'T1 · 11/0.4 kV · 1 MVA', { size: 's', align: 'start' }),
      T(1156, 505, 'T2 · 11/0.4 kV · 1 MVA', { size: 's', align: 'end' }),
      T(712, 376, 'VT', { size: 's', align: 'start' }),
      T(618, 376, 'Q2', { size: 's', align: 'start' }),
      T(798, 376, 'Q3', { size: 's', align: 'start' }),
      T(902, 771, 'Q4', { size: 's', align: 'start' }),
      T(900, 150, 'Energised', { size: 's', align: 'start', tone: 'success' }),
      T(900, 172, 'Warning', { size: 's', align: 'start', tone: 'warning' }),
      T(900, 194, 'De-energised', { size: 's', align: 'start' }),
      { kind: 'zone', x: 20, y: 60, w: 1225, h: 500, text: 'Utility incomer, 11 kV switchboard and transformers' },
      { kind: 'zone', x: 30, y: 600, w: 500, h: 400, text: 'LV board A · 400 V · process' },
      { kind: 'zone', x: 640, y: 600, w: 605, h: 400, text: 'LV board B · 400 V · site services' },
    ],
    elements: [
      // Incomer
      E('grid', 'sld.grid', 70, 240, { label: 'Utility 11 kV' }),
      E('isolator', 'sld.isolator', 170, 240, { label: 'Isolator' }),
      E('ct_incomer', 'sld.ct', 270, 240, { label: 'CT' }),
      E('relay_overcurrent', 'sld.relay', 340, 130, { label: 'Overcurrent' }),
      E('breaker_incomer', 'sld.breaker.trip', 450, 240, { label: 'Incomer Q1' }),
      E('busbar_mv', 'sld.busbar', 685, 240, { length: '3', label: 'MV busbar', labelPos: 't' }),
      // Feeders off the MV bus
      CB('breaker_feeder_1', 595, 370, { label: 'Feeder breaker 1' }),
      E('vt_busbar', 'sld.vt', 685, 370, { label: 'VT', labelPos: 'n' }),
      E('earth_vt', 'sld.earth', 685, 495, { label: 'VT earth', labelPos: 'n' }),
      CB('breaker_feeder_2', 775, 370, { label: 'Feeder breaker 2' }),
      E('transformer_1', 'sld.transformer', 230, 500, { label: 'Transformer 1', labelPos: 'n' }),
      E('transformer_2', 'sld.transformer', 1180, 500, { label: 'Transformer 2', labelPos: 'n' }),
      // LV board A: a drive with its motor and a capacitor bank
      E('busbar_lv_a', 'sld.busbar', 380, 635, { label: 'LV busbar A', labelPos: 'n', length: '2' }),
      E('drive_vfd', 'sld.vfd', 235, 745, { label: 'Drive' }),
      E('motor_pump_m1', 'sld.motor', 110, 870, { label: 'Pump M1' }),
      E('capacitor_bank', 'sld.capacitor', 425, 765, { label: 'Capacitor bank', labelPos: 'n' }),
      E('earth_capacitor', 'sld.earth', 425, 885, { label: 'Capacitor bank earth', labelPos: 'n' }),
      // LV board B: a charging bay, a building load and a solar tie
      E('busbar_lv_b', 'sld.busbar', 880, 635, { label: 'LV busbar B', labelPos: 'n', length: '3' }),
      E('meter_lv', 'energy.smart.meter', 1100, 635, { label: 'Meter', scale: 0.8 }),
      E('ev_charging_bay', 'energy.ev.charger', 1075, 765, { label: 'EV charging bay' }),
      CB('breaker_building', 880, 765, { label: 'Building breaker' }),
      E('building_services', 'sld.load', 880, 890, { label: 'Building services' }),
      E('inverter_solar', 'inverter', 790, 765, { scale: 0.6, label: 'Solar inverter', labelPos: 'n' }),
      E('solar_array', 'solar.panel', 790, 880, { scale: 0.6, label: 'Solar array' }),
    ],
    links: [
      L('grid.r', 'isolator.l', 'sld', { id: 'inc' }),
      L('isolator.r', 'ct_incomer.l', 'sld', { id: 'inc' }),
      L('ct_incomer.r', 'breaker_incomer.l', 'sld', { id: 'inc' }),
      L('breaker_incomer.r', 'busbar_mv.l', 'sld', { id: 'inc' }),
      L('ct_incomer.t', 'relay_overcurrent.l', 'wire', { id: 'sig' }),
      L('relay_overcurrent.r', 'breaker_incomer.t', 'wire', { id: 'trip' }),
      L('busbar_mv.b:0.1667', 'breaker_feeder_1.t', 'sld', { id: 'f1' }),
      L('breaker_feeder_1.b', 'transformer_1.t', 'sld', { id: 'f1' }),
      L('busbar_mv.b:0.5', 'vt_busbar.t', 'sld', { id: 'vt' }),
      L('vt_busbar.b', 'earth_vt.t', 'sld', { id: 'vt' }),
      L('busbar_mv.b:0.8333', 'breaker_feeder_2.t', 'sld', { id: 'f2' }),
      L('breaker_feeder_2.b', 'transformer_2.t', 'sld', { id: 'f2' }),
      // 400 V board A
      L('transformer_1.b', 'busbar_lv_a.l', 'sld', { id: 'a' }),
      L('busbar_lv_a.b:0.25', 'drive_vfd.r', 'sld', { id: 'drive' }),
      L('drive_vfd.l', 'motor_pump_m1.t', 'sld', { id: 'drive' }),
      L('busbar_lv_a.b:0.75', 'capacitor_bank.t', 'sld', { id: 'cap' }),
      L('capacitor_bank.b', 'earth_capacitor.t', 'sld', { id: 'cap' }),
      // 400 V board B
      L('transformer_2.b', 'meter_lv.r', 'sld', { id: 'b' }),
      L('meter_lv.l', 'busbar_lv_b.r', 'sld', { id: 'b' }),
      L('busbar_lv_b.b:0.8333', 'ev_charging_bay.l', 'sld', { id: 'evl' }),
      L('busbar_lv_b.b:0.5', 'breaker_building.t', 'sld', { id: 'bldl' }),
      L('breaker_building.b', 'building_services.t', 'sld', { id: 'bldl' }),
      L('busbar_lv_b.b:0.1667', 'inverter_solar.t', 'sld', { id: 'sol' }),
      L('inverter_solar.b', 'solar_array.t', 'cable', { id: 'pvl' }),
    ],
  },
  rows: merge(
    // Energised parts take the state colour; the capacitor bank is switched off and the drive feeder warns.
    on('grid', 'isolator', 'ct_incomer', 'breaker_incomer', 'busbar_mv', 'breaker_feeder_1', 'breaker_feeder_2', 'vt_busbar', 'transformer_1', 'transformer_2', 'busbar_lv_a', 'busbar_lv_b', 'meter_lv', 'ev_charging_bay', 'breaker_building', 'building_services', 'inverter_solar', 'solar_array', 'motor_pump_m1', 'relay_overcurrent'),
    on('inc', 'sig', 'f1', 'vt', 'f2', 'a', 'b', 'evl', 'bldl', 'sol', 'pvl'),
    [
      { id: 'trip', running: false },
      { id: 'drive', running: true, status: 'warning' },
      { id: 'drive_vfd', running: true, status: 'warning' },
      { id: 'cap', running: false },
      { id: 'capacitor_bank', running: false },
      { id: 'meter_lv', value: 184.6 },
      { id: 'inverter_solar', value: 38.4 },
      { id: 'ev_charging_bay', value: 22 },
    ],
  ),
};

/** The board: the diagram with a supply status, the transformer load, its winding temperature and the plant demand beside it. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Power distribution', [
  scenePlacement(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Supply status', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Utility supply',
    states: [
      { match: 'RUNNING', label: 'Energised', color: OK, icon: 'fas fa-bolt', pulse: true },
      { match: 'STOPPED', label: 'Dead', color: BAD, icon: 'fas fa-plug-circle-xmark' },
      { match: 'IDLE', label: 'On generator', color: WARN, icon: 'fas fa-pause' },
    ],
    showSince: true,
  }),
  P('load', 'gauge', 'Transformer T1 load', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'T1 load', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('oil', 'stat.value', 'Winding temperature', 9, 7, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'T1 winding', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('draw', 'stat.sparkline', 'Plant demand', 9, 10, 3, 3, { series: 'sample.power' }, {
    label: 'Last 12 hours', showChange: 'percent', increaseIs: 'bad', fill: 'gradient', $format: { unit: 'kW', decimals: 0 },
  }),
]);
