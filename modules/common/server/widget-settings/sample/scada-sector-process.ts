// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-process.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "process" sector sample: a P&ID-style heat-exchange skid. It shows the generic process equipment (vessels, plate
// exchanger, boiler, control valve) with ISA instrument bubbles (level, flow and temperature transmitters, a temperature
// controller) joined by pipes and signal wires (pure data).

import type { BoardDocument } from '../settings/board';
import { board, BAD, OK, P, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

/** Feed tank, pump, control valve, plate exchanger heated by a boiler, a hot water buffer, and the loops that control it. */
export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.process',
  title: 'Heat-exchange skid · P&ID',
  settings: {
    width: 1260, height: 640, scale: 0.7, background: 'dots',
    shapes: [
      { kind: 'text', x: 24, y: 34, text: 'Heat-exchange skid', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 1220, h: 540, text: 'Process unit 100' },
      { kind: 'text', x: 692, y: 232, text: 'Condensate return', size: 's', align: 'end' },
      { kind: 'text', x: 735, y: 420, text: 'Plate exchanger E-101', size: 's', align: 'start' },
      { kind: 'text', x: 1215, y: 585, text: 'FT flow · TT temperature · LT level · TIC temperature controller', size: 's', align: 'end' },
    ],
    elements: [
      E('tank_v101', 'process.vessel.vertical', 110, 330, { scale: 1.5, label: 'Feed tank V-101', min: 0, max: 100 }),
      E('lt_101', 'isa.level', 110, 160, { label: 'LT-101', labelPos: 't', valuePos: 'r' }),
      E('pump_p101', 'pump.motor', 270, 330, { label: 'Feed pump P-101' }),
      E('valve_check', 'valve.check', 370, 330, { label: 'Check valve', labelPos: 'n' }),
      E('tee_feed', 'pipe.tee', 450, 330, { label: 'Feed tee', labelPos: 'n', turn: '180' }),
      E('ft_101', 'isa.flow', 450, 190, { label: 'FT-101', labelPos: 't', valuePos: 'r' }),
      E('fv_101', 'process.valve.control', 560, 330, { label: 'FV-101' }),
      E('exchanger_hx101', 'process.exchanger.plate', 710, 330, { label: 'Plate exchanger HX-101', scale: 1.3, labelPos: 'n' }),
      E('tee_hot', 'pipe.tee', 870, 330, { label: 'Hot water tee', labelPos: 'n', turn: '180' }),
      E('tt_101', 'isa.temperature', 870, 190, { label: 'TT-101', labelPos: 't', showValue: false }),
      E('tic_101', 'isa.controller.temperature', 1010, 190, { label: 'TIC-101', labelPos: 't', valuePos: 'r' }),
      E('buffer_v102', 'process.vessel.horizontal', 1080, 330, { scale: 1.3, label: 'Hot water buffer V-102', min: 0, max: 100 }),
      E('boiler_b101', 'process.boiler', 710, 520, { label: 'Boiler B-101', min: 0, max: 100 }),
      E('drain_return', 'drain', 710, 200, { label: 'Return', turn: '180', labelPos: 'n' }),
    ],
    links: [
      L('tank_v101.r', 'pump_p101.l', 'pipe', { medium: 'cold' }),
      L('pump_p101.r', 'valve_check.l', 'pipe', { medium: 'cold' }),
      L('valve_check.r', 'tee_feed.l', 'pipe', { medium: 'cold' }),
      L('tee_feed.r', 'fv_101.l', 'pipe', { medium: 'cold', id: 'cold' }),
      L('fv_101.r', 'exchanger_hx101.l', 'pipe', { medium: 'cold', id: 'cold' }),
      L('exchanger_hx101.r', 'tee_hot.l', 'pipe', { medium: 'hot', id: 'hot' }),
      L('tee_hot.r', 'buffer_v102.l', 'pipe', { medium: 'hot', id: 'hot' }),
      L('boiler_b101.t', 'exchanger_hx101.b', 'pipe', { medium: 'hot', id: 'steam' }),
      L('exchanger_hx101.t', 'drain_return.b', 'pipe', { medium: 'hot', id: 'steam' }),
      // Instrument taps and signals.
      L('lt_101.b', 'tank_v101.t', 'wire'),
      L('ft_101.b', 'tee_feed.t', 'wire'),
      L('tt_101.b', 'tee_hot.t', 'wire'),
      L('tt_101.r', 'tic_101.l', 'wire', { id: 'sig' }),
      L('tic_101.t', 'fv_101.t', 'wire', { id: 'sig', mid: 100 }),
    ],
  },
  rows: [
    { id: 'tank_v101', value: 64 }, { id: 'lt_101', value: 64, running: true },
    { id: 'pump_p101', running: true }, { id: 'valve_check', running: true }, { id: 'tee_feed', running: true },
    { id: 'ft_101', value: 42.5, running: true }, { id: 'fv_101', value: 55, running: true },
    { id: 'exchanger_hx101', running: true }, { id: 'tee_hot', running: true },
    { id: 'tt_101', value: 71, status: 'warning', running: true }, { id: 'tic_101', value: 70, running: true },
    { id: 'buffer_v102', value: 48 }, { id: 'boiler_b101', value: 62, running: true }, { id: 'drain_return', running: true },
    { id: 'cold', running: true }, { id: 'hot', running: true }, { id: 'steam', running: true }, { id: 'sig', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Process skid (P&ID)', [
  scene(SECTOR_SCENE, 9, 13),
  P('temp', 'stat.value', 'Outlet temperature', 9, 0, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'TT-101', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('target', 'control.setpoint', 'Temperature setpoint', 9, 3, 3, 4, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'TIC-101 setpoint', min: 40, max: 90, step: 1, $format: { unit: '°C', decimals: 0 },
  }),
  P('valve', 'gauge', 'Valve opening', 9, 7, 3, 3, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'FV-101', $format: { unit: '%' }, ranges: [{ to: 15, color: WARN }, { from: 15, to: 90, color: OK }, { from: 90, color: BAD }],
  }),
  P('pump', 'control.switch', 'Feed pump', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'P-101', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('trend', 'chart.line', 'Outlet temperature trend', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Alarms', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
