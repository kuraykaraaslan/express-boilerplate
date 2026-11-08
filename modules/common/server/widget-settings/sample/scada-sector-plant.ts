// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-plant.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "plant" sample: a small chemical plant (feed pumps, a jacketed reactor, a centrifuge, a dryer, a scrubber, a screw
// conveyor and a hopper) with its safety zone (gas, flame detectors, a PLC and an HMI on wires, an emergency-stop
// loop with a beacon and a siren) and the board built around it (pure data). It uses the `fluid`, `mech` and `safety`
// packs together with the existing water, process and ISA symbols.

import type { BoardDocument } from '../settings/board';
import { board, BAD, OK, P, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.plant',
  title: 'Chemical plant · reaction and separation',
  settings: {
    width: 1580, height: 1100, scale: 1, background: 'dots',
    shapes: [
      { kind: 'text', x: 24, y: 34, text: 'Chemical plant', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 56, w: 810, h: 960, text: 'Feed, reaction and separation' },
      { kind: 'zone', x: 40, y: 460, w: 520, h: 340, text: 'Wash-water skid' },
      { kind: 'zone', x: 840, y: 372, w: 700, h: 690, text: 'Drying, scrubbing and handling' },
      { kind: 'zone', x: 850, y: 56, w: 690, h: 300, text: 'Safety zone', tone: 'warning' },
      { kind: 'text', x: 1525, y: 1082, text: 'GD-201 reactor bay · GD-202 dryer bay · UV flame · ES e-stop · AT stack', size: 's', align: 'end' },
      { kind: 'text', x: 525, y: 206, text: 'FT-104', size: 's', align: 'end' },
      { kind: 'text', x: 665, y: 446, text: 'XV-102', size: 's', align: 'end' },
      { kind: 'text', x: 665, y: 556, text: 'FT-102', size: 's', align: 'end' },
      { kind: 'text', x: 640, y: 716, text: 'Centrifuge C-101', size: 's', align: 'end' },
      { kind: 'text', x: 665, y: 781, text: 'FT-103', size: 's', align: 'end' },
      { kind: 'text', x: 1100, y: 850, text: 'Screw conveyor SC-101', size: 's', align: 'end' },
      { kind: 'text', x: 800, y: 500, text: 'Slurry to centrifuge', size: 's', align: 'start' },
      { kind: 'text', x: 800, y: 838, text: 'Centrate', size: 's', align: 'start' },
    ],
    elements: [
      // Feed A.
      E('tank_t101', 'mech.tank.cone', 100, 186, { scale: 1.2, label: 'Feed tank T-101', labelPos: 't', valuePos: 'r', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('pump_p101', 'fluid.pump.gear', 260, 306, { label: 'Feed pump P-101' }),
      E('ft_101', 'fluid.flow.magnetic', 380, 306, { label: 'FT-101', unit: 'm³/h', decimals: 1 }),
      E('xv_101', 'fluid.valve.globe', 480, 306, { label: 'XV-101' }),
      E('tee_reactor_feed', 'pipe.tee', 570, 306, { label: 'Reactor feed tee', labelPos: 'n', turn: '180' }),
      // Feed B (catalyst), joining from above.
      E('vessel_v102', 'process.vessel.vertical', 330, 140, { label: 'Catalyst V-102', labelPos: 't', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('pump_p102', 'fluid.pump.peristaltic', 460, 140, { label: 'Dosing pump P-102', labelPos: 't' }),
      E('ft_103', 'fluid.flow.vortex', 570, 206, { label: 'FT-103', turn: '90', labelPos: 'n', valuePos: 'r', unit: 'L/h', decimals: 1 }),
      // Reactor and the slurry line down to the centrifuge.
      E('reactor_r101', 'mech.reactor', 720, 306, { scale: 1.5, label: 'Reactor R-101', labelPos: 't', valuePos: 'r', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('xv_102', 'fluid.valve.diaphragm', 720, 446, { label: 'XV-102', turn: '90', labelPos: 'n' }),
      E('ft_102', 'fluid.flow.ultrasonic', 720, 556, { label: 'FT-102', turn: '90', labelPos: 'n', valuePos: 'r', unit: 'm³/h', decimals: 1 }),
      E('centrifuge_c101', 'mech.centrifuge', 720, 676, { label: 'Centrifuge C-101', labelPos: 'n' }),
      E('ft_104', 'fluid.flow.coriolis', 720, 781, { label: 'FT-104', turn: '90', labelPos: 'n', valuePos: 'r', unit: 'kg/min', decimals: 1 }),
      E('tank_v103', 'process.vessel.vertical', 720, 896, { label: 'Centrate tank V-103', min: 0, max: 100, unit: '%', decimals: 0 }),
      // Wash-water skid.
      E('pump_p104', 'fluid.pump.submersible', 100, 700, { label: 'Well pump P-104' }),
      E('pr_101', 'fluid.regulator', 200, 640, { label: 'PR-101' }),
      E('fo_101', 'fluid.flow.orifice', 270, 640, { label: 'FO-101', unit: 'm³/h', decimals: 1 }),
      E('tee_accumulator', 'pipe.tee', 350, 640, { label: 'Accumulator tee', labelPos: 'n', turn: '180' }),
      E('accumulator_a101', 'fluid.accumulator', 350, 540, { label: 'Accumulator A-101', labelPos: 't', min: 0, max: 100, unit: '%', decimals: 0, valuePos: 'r' }),
      E('nv_101', 'fluid.valve.needle', 430, 640, { label: 'NV-101' }),
      E('drain_nv101', 'drain', 510, 640, { label: 'Drain', labelPos: 'n' }),
      // Drying, scrubbing, handling.
      E('dryer_d101', 'mech.dryer', 920, 742, { label: 'Dryer D-101' }),
      E('scrubber_s101', 'mech.scrubber', 1120, 596, { scale: 1.4, label: 'Scrubber S-101', min: 0, max: 100, unit: '%', decimals: 0 }),
      E('at_201', 'isa.analyzer', 1120, 460, { label: 'AT-201', labelPos: 't', valuePos: 'r', unit: 'ppm', decimals: 0 }),
      E('conveyor_cv101', 'mech.conveyor.screw', 1210, 846, { label: 'Screw conveyor CV-101', length: '2', labelPos: 'n' }),
      E('hopper_h101', 'process.hopper', 1284, 966, { label: 'Product hopper H-101', min: 0, max: 100, unit: '%', decimals: 0 }),
      // Safety zone.
      E('gd_201', 'safety.detector.gas', 930, 130, { label: 'GD-201', min: 0, max: 100, unit: '%LEL', decimals: 0 }),
      E('gd_202', 'safety.detector.gas', 1040, 130, { label: 'GD-202', min: 0, max: 100, unit: '%LEL', decimals: 0 }),
      E('uv_201', 'safety.detector.flame', 1150, 130, { label: 'UV-201' }),
      E('plc_201', 'safety.plc', 1300, 130, { label: 'PLC-201' }),
      E('hmi_201', 'safety.hmi', 1460, 130, { label: 'HMI-201', unit: '%', decimals: 0 }),
      E('es_201', 'safety.estop', 930, 270, { label: 'ES-201' }),
      E('mcc_1', 'safety.mcc', 1050, 270, { label: 'MCC-1', unit: 'A', decimals: 1 }),
      E('beacon_h201', 'safety.beacon', 1170, 270, { label: 'H-201' }),
      E('siren_sr201', 'safety.siren', 1280, 270, { label: 'SR-201' }),
    ],
    links: [
      L('pump_p104.t', 'pr_101.l', 'pipe', { medium: 'water', id: 'wash' }),
      L('pr_101.r', 'fo_101.l', 'pipe', { medium: 'water', id: 'wash' }),
      L('fo_101.r', 'tee_accumulator.l', 'pipe', { medium: 'water', id: 'wash' }),
      L('tee_accumulator.r', 'nv_101.l', 'pipe', { medium: 'water', id: 'wash' }),
      L('nv_101.r', 'drain_nv101.l', 'pipe', { medium: 'water', id: 'wash' }),
      L('accumulator_a101.b', 'tee_accumulator.t', 'pipe', { medium: 'water', id: 'wash' }),
      L('tank_t101.b', 'pump_p101.l', 'pipe', { medium: 'cold', id: 'feedA' }),
      L('pump_p101.r', 'ft_101.l', 'pipe', { medium: 'cold', id: 'feedA' }),
      L('ft_101.r', 'xv_101.l', 'pipe', { medium: 'cold', id: 'feedA' }),
      L('xv_101.r', 'tee_reactor_feed.l', 'pipe', { medium: 'cold', id: 'feedA' }),
      L('tee_reactor_feed.r', 'reactor_r101.l', 'pipe', { medium: 'cold', id: 'feedA' }),
      L('vessel_v102.r', 'pump_p102.l', 'pipe', { medium: 'water', id: 'feedB' }),
      L('pump_p102.r', 'ft_103.t', 'pipe', { medium: 'water', id: 'feedB' }),
      L('reactor_r101.b', 'xv_102.t', 'pipe', { medium: 'hot', id: 'slurry' }),
      L('xv_102.b', 'ft_102.t', 'pipe', { medium: 'hot', id: 'slurry' }),
      L('ft_102.b', 'centrifuge_c101.t', 'pipe', { medium: 'hot', id: 'slurry' }),
      L('centrifuge_c101.b', 'ft_104.t', 'pipe', { medium: 'cold', id: 'centrate' }),
      L('ft_104.b', 'tank_v103.t', 'pipe', { medium: 'cold', id: 'centrate' }),
      L('centrifuge_c101.b:0.757', 'dryer_d101.t:0.08', 'line', { id: 'cake' }),
      L('dryer_d101.t', 'scrubber_s101.l', 'pipe', { id: 'offgas' }),
      // the dried product is solids: it falls down chutes onto the screw conveyor and into the hopper (D37-3, docs/phases/07-dashboard/37),
      // a material line, never a pipe; in 3D the line becomes the conveyor carrier between the items' conveyor ports
      L('dryer_d101.r', 'conveyor_cv101.t:0.32', 'line', { id: 'dry' }),
      L('conveyor_cv101.b:0.87', 'hopper_h101.t', 'line', { id: 'dry' }),
      L('at_201.b', 'scrubber_s101.t', 'wire', { id: 'sig' }),
      // Safety wiring.
      L('gd_201.r', 'gd_202.l', 'wire', { id: 'loop' }),
      L('gd_202.r', 'uv_201.l', 'wire', { id: 'loop' }),
      L('uv_201.r', 'plc_201.l', 'wire', { id: 'loop' }),
      L('plc_201.r', 'hmi_201.l', 'wire', { id: 'net' }),
      L('es_201.r', 'mcc_1.l', 'wire', { id: 'trip' }),
      L('mcc_1.r', 'beacon_h201.l', 'wire', { id: 'trip' }),
      L('beacon_h201.r', 'siren_sr201.l', 'wire', { id: 'trip' }),
    ],
  },
  rows: [
    { id: 'tank_t101', value: 72 }, { id: 'pump_p101', running: true }, { id: 'ft_101', value: 24.6, running: true }, { id: 'xv_101', running: true }, { id: 'tee_reactor_feed', running: true },
    { id: 'vessel_v102', value: 55 }, { id: 'pump_p102', running: true }, { id: 'ft_103', value: 3.2, running: true },
    { id: 'reactor_r101', value: 64, running: true },
    { id: 'pump_p104', running: true }, { id: 'pr_101', running: true }, { id: 'fo_101', value: 6.2, running: true }, { id: 'tee_accumulator', running: true }, { id: 'accumulator_a101', value: 55, running: true }, { id: 'nv_101', running: true }, { id: 'drain_nv101', running: true }, { id: 'wash', running: true },
    { id: 'xv_102', running: true }, { id: 'ft_102', value: 18.4, running: true },
    { id: 'centrifuge_c101', running: true }, { id: 'ft_104', value: 12.1, running: true }, { id: 'tank_v103', value: 38 },
    { id: 'dryer_d101', running: true }, { id: 'scrubber_s101', value: 46, running: true }, { id: 'at_201', value: 14, running: true },
    { id: 'conveyor_cv101', running: true }, { id: 'hopper_h101', value: 33 },
    { id: 'gd_201', value: 24, running: true, status: 'warning' }, { id: 'gd_202', value: 4, running: true }, { id: 'uv_201', running: true },
    { id: 'plc_201', running: true }, { id: 'hmi_201', value: 64, running: true },
    { id: 'es_201', running: true }, { id: 'mcc_1', value: 18.4, running: true }, { id: 'beacon_h201', status: 'warning', running: true }, { id: 'siren_sr201', running: false },
    { id: 'feedA', running: true }, { id: 'feedB', running: true }, { id: 'slurry', running: true }, { id: 'centrate', running: true },
    { id: 'cake', running: true }, { id: 'offgas', running: true }, { id: 'dry', running: true },
    { id: 'sig', running: true }, { id: 'loop', running: true }, { id: 'net', running: true }, { id: 'trip', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Chemical plant', [
  scene(SECTOR_SCENE, 9, 13),
  P('reactor', 'stat.value', 'Reactor temperature', 9, 0, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'TT-101 reactor', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('target', 'control.setpoint', 'Reactor setpoint', 9, 3, 3, 4, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'TIC-101 setpoint', min: 40, max: 90, step: 1, $format: { unit: '°C', decimals: 0 },
  }),
  P('gas', 'gauge', 'Reactor bay gas', 9, 7, 3, 3, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'GD-201', $format: { unit: '%LEL' }, ranges: [{ to: 20, color: OK }, { from: 20, to: 40, color: WARN }, { from: 40, color: BAD }],
  }),
  P('pump', 'control.switch', 'Feed pump', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'P-101', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('trend', 'chart.line', 'Reactor temperature trend', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Alarms', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
