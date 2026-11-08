// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-food.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "food" sector sample: a dairy and beverage plant as one process diagram with its readings, and the board built
// around it (pure data): milk reception, the tank, pasteurisation and homogenising, a fermenter and an ageing vessel,
// CIP, and the filling line (filler, capper, bottle conveyor, cold store).

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Row = Record<string, unknown>;
type Elem = Record<string, unknown>;

/** The drawing is laid out on a 0.55 grid and spread by `K` so that the symbols can be drawn larger (scale 0.75). */
const K = 0.75 / 0.55;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x: Math.round(x * K * 10) / 10, y: Math.round(y * K * 10) / 10, ...extra });
const Z = (x: number, y: number, w: number, h: number, text: string, tone: string): Elem => ({ kind: 'zone', x: Math.round(x * K), y: Math.round(y * K), w: Math.round(w * K), h: Math.round(h * K), text, tone });
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

const MILK = { medium: 'water' };
const CLEAN = { medium: 'custom', mediumColor: 'var(--warning)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.food',
  title: 'Dairy and beverage',
  settings: {
    width: 1800, height: 900, scale: 0.75, background: 'dots',
    shapes: [
      { kind: 'text', x: 28, y: 44, text: 'Dairy plant · milk to bottle', size: 'l', align: 'start' },
      Z(10, 56, 355, 140, 'Milk reception', 'neutral'),
      Z(370, 56, 100, 140, 'Raw milk tank', 'info'),
      Z(470, 262, 436, 140, 'Pasteurisation and homogenising', 'warning'),
      Z(818, 126, 92, 130, 'Fermenter', 'neutral'),
      Z(916, 262, 250, 140, 'Ageing vessel and CIP', 'neutral'),
      Z(440, 474, 370, 142, '', 'success'),
      { kind: 'text', x: Math.round(800 * K), y: Math.round(608 * K), text: 'Filling and packing', size: 's', align: 'end' },
    ],
    elements: [
      // milk reception (y = 110)
      E('valve_intake', 'valve.ball', 50, 110, { label: 'Tanker intake' }),
      E('strainer', 'strainer', 140, 110, { label: 'Strainer' }),
      E('meter_flow_intake', 'meter.flow', 230, 110, { label: 'Intake flow meter', labelPos: 'n' }),
      E('pump_reception', 'food.pump.sanitary', 320, 110, { label: 'Reception pump' }),
      E('tank_storage', 'food.tank.storage', 418, 110, { label: 'Storage tank', scale: 1.3, labelPos: 'n', min: 0, max: 100, valuePos: 'r', showValue: false }),
      // treatment (y = 330)
      E('pump_feed', 'food.pump.sanitary', 506, 330, { label: 'Feed pump' }),
      E('pasteuriser', 'food.pasteurizer', 623, 330, { label: 'Pasteuriser' }),
      E('homogeniser', 'food.homogenizer', 757, 330, { label: 'Homogeniser' }),
      E('tee_fill', 'pipe.tee', 863.5, 330, { label: 'Filling tee', labelPos: 'n', turn: '180' }),
      E('bioreactor', 'food.bioreactor', 863.5, 190, { label: 'Bioreactor', scale: 1.2, labelPos: 'n', min: 0, max: 100, valuePos: 'r', showValue: false }),
      E('vessel_ageing', 'food.vessel.jacketed', 959, 330, { label: 'Ageing vessel', scale: 1.2, labelPos: 'n', min: 0, max: 100, valuePos: 'r', showValue: false }),
      E('cip_skid', 'food.cip.skid', 1100, 330, { label: 'CIP skid' }),
      // filling line (y = 540): the bottles pass filler, capper, conveyor and reach the cold store
      E('valve_filler', 'valve.ball', 870, 450, { label: 'Filler valve', labelPos: 't' }),
      E('filler', 'food.filler', 520, 540, { label: 'Filler' }),
      E('capper', 'food.capper', 575, 540, { label: 'Capper', labelPos: 't' }),
      E('conveyor_bottle', 'food.conveyor.bottle', 657.5, 540, { length: '2', label: 'Bottle conveyor' }),
      E('cold_store', 'food.cold.room', 751, 540, { label: 'Cold store' }),
    ],
    links: [
      L('valve_intake.r', 'strainer.l', 'pipe', { ...MILK, id: 'valve_intake' }),
      L('strainer.r', 'meter_flow_intake.l', 'pipe', { ...MILK, id: 'valve_intake' }),
      L('meter_flow_intake.r', 'pump_reception.l', 'pipe', { ...MILK, id: 'pump_reception' }),
      L('pump_reception.r', 'tank_storage.l', 'pipe', { ...MILK, id: 'pump_reception', arrows: true }),
      L('tank_storage.b', 'pump_feed.l', 'pipe', { ...MILK, id: 'pump_feed' }),
      L('pump_feed.r', 'pasteuriser.l', 'pipe', { ...MILK, id: 'pump_feed' }),
      L('pasteuriser.r', 'homogeniser.l', 'pipe', { ...MILK, id: 'pasteuriser', arrows: true }),
      L('homogeniser.r', 'tee_fill.l', 'pipe', { ...MILK, id: 'homogeniser' }),
      L('tee_fill.r', 'vessel_ageing.l', 'pipe', { ...MILK, id: 'homogeniser' }),
      L('tee_fill.t', 'bioreactor.b', 'pipe', { ...MILK, id: 'homogeniser' }),
      L('vessel_ageing.b', 'valve_filler.r', 'pipe', { ...MILK, id: 'vessel_ageing' }),
      L('valve_filler.l', 'filler.t', 'pipe', { ...MILK, id: 'vessel_ageing', arrows: true }),
      // cleaning in place: hoses from the skid to the ageing vessel and the raw milk tank
      L('cip_skid.l', 'vessel_ageing.r', 'hose', { ...CLEAN, id: 'cip_skid' }),
      L('cip_skid.t', 'tank_storage.r', 'hose', { ...CLEAN, id: 'cip_skid' }),
    ],
  },
  rows: merge(
    on('valve_intake', 'strainer', 'meter_flow_intake', 'pump_reception', 'tank_storage', 'pump_feed', 'pasteuriser', 'homogeniser', 'tee_fill', 'bioreactor', 'vessel_ageing', 'valve_filler', 'filler', 'capper', 'conveyor_bottle', 'cold_store'),
    [
      { id: 'meter_flow_intake', value: 18 },
      { id: 'tank_storage', value: 72, label: 'Raw milk tank' },
      { id: 'pasteuriser', value: 72.5 },
      { id: 'homogeniser', value: 62 },
      { id: 'bioreactor', value: 58 },
      { id: 'vessel_ageing', value: 61 },
      { id: 'cip_skid', running: false, value: 85 },
      { id: 'cold_store', value: 7.5, status: 'warning' },
    ],
  ),
};

/** The plant with what an operator keeps beside it: status, pasteuriser temperature, homogeniser pressure, the trend. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Dairy and beverage', [
  scene(SECTOR_SCENE, 9, 10),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Dairy plant'), showSince: true }),
  P('temp', 'stat.value', 'Pasteuriser outlet', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Holding temperature', icon: 'fas fa-temperature-high', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('pressure', 'gauge', 'Homogeniser pressure', 9, 6, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Pressure', needle: true, $format: { unit: 'bar' },
    ranges: [{ to: 60, color: OK }, { from: 60, to: 85, color: WARN }, { from: 85, color: BAD }],
  }),
  P('filler', 'control.switch', 'Filler', 0, 10, 3, 3, { value: 'sample.pump' }, { label: 'Filling line', icon: 'fas fa-bottle-water', stateDisplay: 'pill' }),
  P('trend', 'chart.line', 'Holding temperature trend', 3, 10, 6, 5, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Line events', 9, 10, 3, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
