// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-pharma.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "pharma" sector sample: one process diagram with its readings and the board built around it (pure data).
// A small fill-finish suite: a WFI still feeds the WFI tank and its distribution loop, the loop supplies a fermenter
// whose harvest goes to the vial filler, and a CIP unit cleans the fermenter. Below, the cleanroom grades are drawn as
// zones with their pressure cascade (15, 30 and 45 Pa): autoclaved parts and a pass box enter the filling zone, vials go
// through the filler, the freeze dryer and the inspection isolator. The isolator carries an unacknowledged alarm.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const WFI = { medium: 'custom', mediumColor: 'var(--info)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.pharma',
  title: 'Fill-finish suite',
  settings: {
    width: 1340, height: 735, scale: 0.85, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 40, text: 'Fill-finish suite', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 520, h: 290, text: 'Water for injection loop' },
      { kind: 'zone', x: 560, y: 60, w: 750, h: 290, text: 'Upstream (grade D)' },
      { kind: 'zone', x: 20, y: 370, w: 330, h: 300, text: 'Grade D · 15 Pa' },
      { kind: 'zone', x: 360, y: 370, w: 140, h: 300, text: 'Grade C · 30 Pa' },
      { kind: 'zone', x: 510, y: 370, w: 800, h: 300, text: 'Grade B and A · 45 Pa' },
      { kind: 'text', x: 30, y: 705, text: 'Pressure cascade: the filling zone is held above the rooms around it', size: 's', align: 'start' },
    ],
    elements: [
      E('wfi_still', 'pharma.still', 90, 160, { label: 'WFI still', min: 0, max: 5, unit: 'µS/cm', decimals: 1 }),
      E('wfi_tank', 'pharma.tank.wfi', 250, 160, { label: 'WFI tank', labelPos: 't', showValue: false, min: 0, max: 100, unit: '%', decimals: 0 }),
      E('pump_loop', 'pump.motor', 440, 260, { label: 'Loop pump' }),
      E('tee_wfi_loop', 'pipe.tee', 443.4, 160, { label: 'WFI loop tee', labelPos: 'n', turn: '0', ...WFI }),
      E('fermenter', 'pharma.fermenter', 700, 160, { label: 'Fermenter', labelPos: 't', showValue: false, min: 0, max: 100, unit: '%', decimals: 0 }),
      E('cip_unit', 'pharma.cip', 930, 160, { label: 'CIP unit', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('air_shower', 'pharma.airshower', 90, 580, { label: 'Air shower' }),
      E('autoclave', 'pharma.autoclave', 240, 580, { label: 'Autoclave', min: 0, max: 140, unit: '°C', decimals: 0 }),
      E('pass_box', 'pharma.passbox', 430, 580, { label: 'Pass box' }),
      E('vial_filler', 'pharma.filler.vial', 700, 580, { label: 'Vial filler' }),
      E('freeze_dryer', 'pharma.lyophilizer', 880, 580, { label: 'Freeze dryer', min: -60, max: 40, unit: '°C', decimals: 0 }),
      E('isolator_inspection', 'pharma.isolator', 1040, 580, { label: 'Inspection isolator', min: 0, max: 60, unit: 'Pa', decimals: 0 }),
      E('laminar_hood', 'pharma.hood.laminar', 1210, 580, { label: 'Laminar hood', min: 0, max: 1, unit: 'm/s', decimals: 2 }),
    ],
    links: [
      L('wfi_still.r', 'wfi_tank.l', 'pipe', { id: 'feed', ...WFI }),
      L('wfi_tank.b', 'pump_loop.l', 'pipe', { id: 'suction', ...WFI }),
      L('pump_loop.t', 'tee_wfi_loop.b', 'pipe', { id: 'discharge', ...WFI }),
      L('tee_wfi_loop.l', 'wfi_tank.t', 'pipe', { id: 'return', ...WFI }),
      L('tee_wfi_loop.r', 'fermenter.l', 'pipe', { id: 'supply', ...WFI }),
      L('fermenter.r', 'cip_unit.l', 'pipe', { id: 'cipline', medium: 'custom', mediumColor: 'var(--warning)' }),
      L('fermenter.b', 'vial_filler.t', 'pipe', { id: 'harvest', medium: 'custom', mediumColor: 'var(--text-secondary)' }),
      L('autoclave.r', 'pass_box.l', 'line', { id: 'l1' }),
      L('pass_box.r', 'vial_filler.l', 'line', { id: 'l2' }),
      L('vial_filler.r', 'freeze_dryer.l', 'line', { id: 'l3' }),
      L('freeze_dryer.r', 'isolator_inspection.l', 'line', { id: 'l4' }),
      L('isolator_inspection.r', 'laminar_hood.l', 'line', { id: 'l5' }),
    ],
  },
  rows: [
    { id: 'wfi_still', running: true, value: 0.8 },
    { id: 'wfi_tank', running: true, value: 72 },
    { id: 'pump_loop', running: true },
    { id: 'tee_wfi_loop', running: true },
    { id: 'fermenter', running: true, value: 64 },
    { id: 'cip_unit', running: false, value: 55 },
    { id: 'air_shower', running: true },
    { id: 'autoclave', running: true, value: 121 },
    { id: 'pass_box', running: true },
    { id: 'vial_filler', running: true },
    { id: 'freeze_dryer', running: true, value: -42 },
    { id: 'isolator_inspection', running: true, value: 31, status: 'critical', ack: false },
    { id: 'laminar_hood', running: true, value: 0.45 },
    { id: 'feed', running: true },
    { id: 'suction', running: true },
    { id: 'discharge', running: true },
    { id: 'return', running: true },
    { id: 'supply', running: true },
    { id: 'harvest', running: true },
    { id: 'l1', running: true },
    { id: 'l2', running: true },
    { id: 'l3', running: true },
    { id: 'l4', running: true },
    { id: 'l5', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Pharma and cleanroom', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Suite status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Fill-finish suite'), showSince: true }),
  P('hepa', 'gauge', 'HEPA loading', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Grade A filters', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 88, color: WARN }, { from: 88, color: BAD }],
  }),
  P('rate', 'stat.sparkline', 'Filling rate', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Vial filler', showChange: 'percent', fill: 'gradient', $format: { unit: 'vials/min', decimals: 0 } }),
  P('wfit', 'stat.value', 'WFI loop', 9, 10, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'WFI loop temperature', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('shelf', 'chart.area', 'Freeze dryer power', 0, 13, 8, 6, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'kW', decimals: 0 } }),
  P('alarms', 'data.feed', 'Alarms', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
