// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-agri.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "agri" sector sample: a farm's irrigation as one process diagram with its readings, and the board built around it
// (pure data): a borehole, a water tank and a fertigation unit feed a centre pivot, three greenhouses (each behind a
// valve, with a drip line and a soil probe) and a yard of sprinklers; a weather station and the probes report to the
// irrigation controller over signal wires.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });
const on = (...ids: string[]): Row[] => ids.map((id) => ({ id, running: true }));
/** Rows merged by id: a later row adds to an earlier one (the scene reads the first row of an id). */
const merge = (...parts: Row[][]): Row[] => {
  const out: Row[] = [];
  for (const r of parts.flat()) {
    const i = out.findIndex((x) => x.id === r.id);
    if (i >= 0) out[i] = { ...out[i], ...r }; else out.push(r);
  }
  return out;
};

const WATER = { medium: 'water' };

/** One greenhouse row: a valve, the glasshouse, its drip line and a soil probe, all on the line y. */
const row = (n: number, y: number): Elem[] => [
  E(`valve_greenhouse_${n}`, 'agri.irrigation.valve', 600, y, { label: `Greenhouse ${n} valve`, labelPos: 'n' }),
  E(`greenhouse_${n}`, 'agri.greenhouse', 740, y, { label: `Greenhouse ${n}`, min: 0, max: 100 }),
  E(`drip_line_${n}`, 'agri.drip.line', 857, y, { label: `Drip line ${n}`, length: '2', labelPos: 'n' }),
  E(`sensor_soil_${n}`, 'agri.soil.sensor', 955, y, { label: `Soil sensor ${n}`, labelPos: 'n' }),
];

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.agri',
  title: 'Greenhouse and irrigation',
  settings: {
    width: 1300, height: 700, scale: 0.65, background: 'dots',
    shapes: [
      { kind: 'text', x: 20, y: 34, text: 'Farm irrigation · greenhouses and field', size: 'l', align: 'start' },
      { kind: 'zone', x: 10, y: 56, w: 520, h: 140, text: 'Water supply and fertigation', tone: 'info' },
      { kind: 'zone', x: 540, y: 56, w: 466, h: 126, text: 'Field irrigation', tone: 'success' },
      { kind: 'zone', x: 1014, y: 56, w: 100, h: 126, text: 'Weather', tone: 'neutral' },
      { kind: 'zone', x: 545, y: 188, w: 461, h: 128, text: 'Greenhouse 1 · tomatoes', tone: 'success' },
      { kind: 'zone', x: 545, y: 318, w: 461, h: 128, text: 'Greenhouse 2 · peppers', tone: 'success' },
      { kind: 'zone', x: 545, y: 448, w: 461, h: 128, text: 'Greenhouse 3 · seedlings', tone: 'success' },
      { kind: 'zone', x: 1090, y: 330, w: 140, h: 110, tone: 'neutral' },
      { kind: 'zone', x: 10, y: 252, w: 420, h: 392, text: 'Farmyard', tone: 'neutral' },
    ],
    elements: [
      // water supply (y = 110)
      E('borehole', 'well.bore', 60, 110, { label: 'Borehole' }),
      E('water_tank', 'agri.water.tank', 190, 110, { scale: 1.2, label: 'Water tank', min: 0, max: 100 }),
      E('fertigation', 'agri.fertigation', 340, 110, { label: 'Fertigation', min: 0, max: 100 }),
      E('tee_pivot', 'pipe.tee', 470, 110, { label: 'Pivot tee', labelPos: 'n' }),
      E('centre_pivot', 'agri.pivot', 860, 110, { label: 'Centre pivot' }),
      E('weather_station', 'agri.weather.station', 1062, 110, { label: 'Station', labelPos: 'n' }),
      // the trunk (x = 470) and the three greenhouse rows
      E('tee_greenhouse_1', 'pipe.tee', 470, 250, { label: 'Greenhouse 1 tee', labelPos: 'n', turn: '270' }),
      E('tee_greenhouse_2', 'pipe.tee', 470, 380, { label: 'Greenhouse 2 tee', labelPos: 'n', turn: '270' }),
      E('tee_greenhouse_3', 'pipe.tee', 470, 510, { label: 'Greenhouse 3 tee', labelPos: 'n', turn: '270' }),
      ...row(1, 250), ...row(2, 380), ...row(3, 510),
      E('controller', 'rtu', 1160, 375, { label: 'Controller' }),
      // the farmyard: a barn, a grain bin and two sprinklers on the yard line (y = 575)
      E('barn', 'agri.barn', 130, 330, { label: 'Barn' }),
      E('grain_bin', 'agri.silo.grain', 280, 330, { label: 'Grain bin', min: 0, max: 100 }),
      E('sprinkler_1', 'agri.sprinkler', 150, 470, { label: 'Sprinkler 1', labelPos: 'n' }),
      E('sprinkler_2', 'agri.sprinkler', 270, 470, { label: 'Sprinkler 2', labelPos: 'n' }),
      E('elbow_sprinklers', 'pipe.elbow', 150, 575, { label: 'Sprinkler elbow', labelPos: 'n', turn: '180' }),
      E('tee_sprinklers', 'pipe.tee', 270, 575, { label: 'Sprinkler tee', labelPos: 'n', turn: '180' }),
    ],
    links: [
      L('borehole.r', 'water_tank.l', 'pipe', { ...WATER, id: 'borehole' }),
      L('water_tank.r', 'fertigation.l', 'pipe', { ...WATER, id: 'water_tank' }),
      L('fertigation.r', 'tee_pivot.l', 'pipe', { ...WATER, id: 'fertigation', arrows: true }),
      L('tee_pivot.r', 'centre_pivot.l', 'pipe', { ...WATER, id: 'centre_pivot' }),
      L('tee_pivot.b', 'tee_greenhouse_1.t', 'pipe', { ...WATER, id: 'fertigation' }),
      L('tee_greenhouse_1.b', 'tee_greenhouse_2.t', 'pipe', { ...WATER, id: 'fertigation' }),
      L('tee_greenhouse_2.b', 'tee_greenhouse_3.t', 'pipe', { ...WATER, id: 'fertigation' }),
      L('tee_greenhouse_1.r', 'valve_greenhouse_1.l', 'pipe', { ...WATER, id: 'valve_greenhouse_1' }),
      L('valve_greenhouse_1.r', 'greenhouse_1.l', 'pipe', { ...WATER, id: 'valve_greenhouse_1' }),
      L('tee_greenhouse_2.r', 'valve_greenhouse_2.l', 'pipe', { ...WATER, id: 'valve_greenhouse_2' }),
      L('valve_greenhouse_2.r', 'greenhouse_2.l', 'pipe', { ...WATER, id: 'valve_greenhouse_2' }),
      L('tee_greenhouse_3.r', 'valve_greenhouse_3.l', 'pipe', { ...WATER, id: 'valve_greenhouse_3' }),
      L('valve_greenhouse_3.r', 'greenhouse_3.l', 'pipe', { ...WATER, id: 'valve_greenhouse_3' }),
      // the yard line
      L('tee_greenhouse_3.b', 'tee_sprinklers.r', 'pipe', { ...WATER, id: 'sprinkler_2' }),
      L('tee_sprinklers.l', 'elbow_sprinklers.r', 'pipe', { ...WATER, id: 'sprinkler_2' }),
      L('sprinkler_1.b', 'elbow_sprinklers.t', 'pipe', { ...WATER, id: 'sprinkler_1' }),
      L('sprinkler_2.b', 'tee_sprinklers.t', 'pipe', { ...WATER, id: 'sprinkler_2' }),
      // sensors report to the controller
      L('sensor_soil_1.r', 'controller.l', 'wire', { id: 'sensor_soil_1' }),
      L('sensor_soil_2.r', 'controller.l', 'wire', { id: 'sensor_soil_2' }),
      L('sensor_soil_3.r', 'controller.l', 'wire', { id: 'sensor_soil_3' }),
      L('weather_station.b', 'controller.t', 'wire', { id: 'weather_station' }),
    ],
  },
  rows: merge(
    on('borehole', 'water_tank', 'fertigation', 'tee_pivot', 'centre_pivot', 'weather_station', 'tee_greenhouse_1', 'tee_greenhouse_2', 'tee_greenhouse_3', 'valve_greenhouse_1', 'valve_greenhouse_2', 'greenhouse_1', 'greenhouse_2', 'drip_line_1', 'drip_line_2', 'sensor_soil_1', 'sensor_soil_2', 'sensor_soil_3', 'controller', 'grain_bin', 'sprinkler_1', 'sprinkler_2', 'elbow_sprinklers', 'tee_sprinklers'),
    [
      { id: 'water_tank', value: 68, label: 'Water tank' },
      { id: 'fertigation', value: 55, value2: 1.8, label: 'Fertigation' },
      { id: 'greenhouse_1', value: 35 }, { id: 'greenhouse_2', value: 60 }, { id: 'greenhouse_3', value: 0 },
      { id: 'valve_greenhouse_3', running: false }, { id: 'greenhouse_3', running: false }, { id: 'drip_line_3', running: false },
      { id: 'sensor_soil_1', value: 38 }, { id: 'sensor_soil_2', value: 42 }, { id: 'sensor_soil_3', value: 24, status: 'warning', running: true },
      { id: 'grain_bin', value: 64 },
      { id: 'sprinkler_1', running: false }, { id: 'sprinkler_2', running: false }, { id: 'elbow_sprinklers', running: false }, { id: 'tee_sprinklers', running: false },
    ],
  ),
};

/** The farm with what an operator keeps beside it: status, greenhouse temperature, tank level, the irrigation set point. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Greenhouse and irrigation', [
  scene(SECTOR_SCENE, 9, 10),
  P('status', 'state', 'Irrigation status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Irrigation'), showSince: true }),
  P('temp', 'stat.value', 'Greenhouse 1 temperature', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Air temperature', icon: 'fas fa-temperature-half', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('level', 'gauge', 'Tank level', 9, 6, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Water tank', needle: true, $format: { unit: '%' },
    ranges: [{ to: 25, color: BAD }, { from: 25, to: 90, color: OK }, { from: 90, color: WARN }],
  }),
  P('pump', 'control.switch', 'Borehole pump', 0, 10, 3, 3, { value: 'sample.pump' }, { label: 'Borehole pump', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('target', 'control.setpoint', 'Greenhouse target', 3, 10, 3, 3, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Greenhouse target', min: 12, max: 32, step: 0.5, $format: { unit: '°C', decimals: 1 },
  }),
  P('trend', 'chart.line', 'Air temperature trend', 6, 10, 3, 5, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Irrigation events', 9, 10, 3, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
