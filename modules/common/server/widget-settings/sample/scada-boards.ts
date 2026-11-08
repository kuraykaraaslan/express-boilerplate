// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-boards.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// Five SCADA boards (pure): each is a process diagram (`scada.scene`) with the widgets an operator keeps beside it.
// They are the gallery's SCADA tabs and starting points for a real board; the diagrams and their readings are in
// `scada-scenes.ts`.

import type { BoardDocument, BoardPlacement } from '../settings/board';
import { SECTOR_BOARDS } from './scada-sector-all';
import { ENERGY_SCENE, LINE_SCENE, NETWORK_SCENE, POOL_SCENE, RIG_SCENE, type ScadaScene } from './scada-scenes';

const P = (id: string, type: string, title: string, x: number, y: number, w: number, h: number, binding: Record<string, string>, settings: Record<string, unknown> = {}): BoardPlacement =>
  ({ id, type, title, x, y, w, h, settings, binding });

const board = (title: string, placements: BoardPlacement[]): BoardDocument =>
  ({ format: 'widgetkit.board', version: 1, templates: {}, board: { title, settings: {} }, placements });

const OK = 'var(--success)';
const BAD = 'var(--error)';
const WARN = 'var(--warning)';

const scene = (s: ScadaScene, w: number, h: number): BoardPlacement => P('scene', 'scada.scene', s.title, 0, 0, w, h, { points: s.source }, s.settings);

const RUNNING = {
  label: 'Plant',
  states: [{ match: 'RUNNING', label: 'Running', color: OK, icon: 'fas fa-circle-check', pulse: true }, { match: 'STOPPED', label: 'Stopped', color: BAD, icon: 'fas fa-circle-xmark' }, { match: 'IDLE', label: 'Idle', color: WARN, icon: 'fas fa-pause' }],
};

/** A pool, its circulation and filtration, a heat pump: pipes, hoses, valves and a sand filter. */
export const SCADA_POOL_BOARD = board('SCADA · Pool plant', [
  scene(POOL_SCENE, 9, 13),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING, showSince: true }),
  P('temp', 'stat.value', 'Pool temperature', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Water', icon: 'fas fa-temperature-half', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('pump', 'control.switch', 'Circulation pump', 9, 6, 3, 3, { value: 'sample.pump' }, { label: 'Pump power', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('target', 'control.setpoint', 'Target temperature', 9, 9, 3, 4, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Heat pump target', min: 20, max: 36, step: 0.5, $format: { unit: '°C', decimals: 1 },
  }),
]);

/** Solar, wind, batteries, an inverter, a breaker, a transformer, a generator and the consumers, joined by cables. */
export const SCADA_ENERGY_BOARD = board('SCADA · Hybrid energy', [
  scene(ENERGY_SCENE, 9, 13),
  P('use', 'stat.sparkline', 'Consumption', 9, 0, 3, 3, { series: 'sample.power' }, { label: 'Last 12 hours', showChange: 'percent', increaseIs: 'bad', fill: 'gradient', $format: { unit: 'kW', decimals: 0 } }),
  P('load', 'gauge', 'Inverter load', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Load', needle: true, $format: { unit: '%' },
    ranges: [{ to: 60, color: OK }, { from: 60, to: 85, color: WARN }, { from: 85, color: BAD }],
  }),
  P('wind', 'control.switch', 'Wind turbine', 9, 7, 3, 3, { value: 'sample.pump' }, { label: 'Turbine', icon: 'fas fa-wind', stateDisplay: 'pill' }),
  P('gen', 'control.switch', 'Generator', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Generator', icon: 'fas fa-bolt', stateDisplay: 'pill' }),
  P('trend', 'chart.line', 'Power draw', 0, 13, 12, 6, { series: 'sample.power' }, { legendValues: ['latest', 'avg'], $format: { unit: 'kW' } }),
]);

/** A strip line from payoff reel to rewind reel: accumulators, a cleaner, a coater, an oven, a quench, a shear. */
export const SCADA_LINE_BOARD = board('SCADA · Coil coating line', [
  scene(LINE_SCENE, 12, 8),
  P('speed', 'stat.value', 'Entry speed', 0, 8, 3, 3, { value: 'sample.cpu' }, { label: 'Strip', icon: 'fas fa-gauge-high', $format: { unit: 'ft/min', decimals: 0 } }),
  P('oven', 'stat.value', 'Oven zone 1', 3, 8, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Temperature', icon: 'fas fa-fire', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 0 },
  }),
  P('fill', 'gauge', 'Accumulator', 6, 8, 3, 3, { value: 'sample.cpu' }, { layout: 'arc', label: 'Filled', $format: { unit: '%' }, ranges: [{ to: 20, color: BAD }, { from: 20, to: 85, color: OK }, { from: 85, color: WARN }] }),
  P('splice', 'control.button', 'Splice', 9, 8, 3, 3, {}, { label: 'Start splice', icon: 'fas fa-scissors', fullWidth: true, confirmQuestion: 'Start the splice sequence now?', confirmLabel: 'Start' }),
  P('trend', 'chart.line', 'Oven temperature', 0, 11, 8, 6, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Line events', 8, 11, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);

/** A city water network: boreholes, a clarifier, chlorination, a pump station, valves, a reservoir, a tower, a hydrant. */
export const SCADA_NETWORK_BOARD = board('SCADA · Water network', [
  scene(NETWORK_SCENE, 9, 13),
  P('level', 'gauge', 'Reservoir level', 9, 0, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Reservoir', $format: { unit: '%' }, ranges: [{ to: 25, color: BAD }, { from: 25, to: 90, color: OK }, { from: 90, color: WARN }],
  }),
  P('flow', 'stat.sparkline', 'Network flow', 9, 4, 3, 3, { series: 'sample.power' }, { label: 'Pump station', showChange: 'percent', fill: 'gradient', $format: { unit: 'm³/h', decimals: 0 } }),
  P('alarms', 'data.feed', 'Alarms', 9, 7, 3, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 4 }),
]);

/** A drilling rig: derrick, drawworks, mud pump, preventer, tanks, a depth gauge, and the parameters as a form. */
export const SCADA_RIG_BOARD = board('SCADA · Drilling rig', [
  scene(RIG_SCENE, 9, 14),
  P('params', 'control.form', 'Drilling parameters', 9, 0, 3, 8, { record: 'sample.scada.rig.params' }, { label: 'Set and save together' }),
  P('pump', 'control.switch', 'Mud pump', 9, 8, 3, 3, { value: 'sample.pump' }, { label: 'Pump', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('rotor', 'control.switch', 'Rotor', 9, 11, 3, 3, { value: 'sample.pump' }, { label: 'Rotor', icon: 'fas fa-rotate', stateDisplay: 'pill' }),
  P('rpm', 'chart.line', 'Rotary speed', 0, 14, 6, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'RPM', decimals: 0 } }),
  P('flowrate', 'chart.line', 'Flow rate', 6, 14, 6, 6, { series: 'sample.power' }, { legend: 'none', $format: { unit: 'L/s', decimals: 0 } }),
]);

export const SAMPLE_SCADA_BOARDS: readonly BoardDocument[] = [SCADA_POOL_BOARD, SCADA_ENERGY_BOARD, SCADA_LINE_BOARD, SCADA_NETWORK_BOARD, SCADA_RIG_BOARD, ...SECTOR_BOARDS];
