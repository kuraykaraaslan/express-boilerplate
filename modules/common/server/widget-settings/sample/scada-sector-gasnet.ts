// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-gasnet.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "gasnet" sector sample: one process diagram with its readings and the board built around it (pure data).
// A gas intake (emergency shutdown valve, filter separator, booster compressor, pressure reduction station, odorizer, gas
// meter) feeds a gasholder and a boiler house; the boiler heats the primary side of a district-heating substation, whose
// secondary circuit serves the radiators of two floors. The filter reports a high differential pressure.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, RUNNING_STATES, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

const HOT = { medium: 'hot' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.gasnet',
  title: 'Gas and district heating',
  settings: {
    width: 1220, height: 520, scale: 0.8, background: 'dots',
    shapes: [
      { kind: 'text', x: 30, y: 36, text: 'Gas station and district heating', size: 'l', align: 'start' },
      { kind: 'zone', x: 20, y: 60, w: 695, h: 300, text: 'Gas intake and regulation' },
      { kind: 'zone', x: 730, y: 60, w: 460, h: 440, text: 'Heating plant and substation', tone: 'warning' },
    ],
    elements: [
      E('valve_intake', 'oilgas.valve.esd', 55, 260, { label: 'Intake', labelPos: 'n' }),
      E('filter_gas', 'gasnet.filter.gas', 165, 260, { label: 'Filter', max: 100 }),
      E('booster', 'gasnet.compressor.station', 270, 260, { label: 'Booster' }),
      E('regulator', 'gasnet.station.regulator', 385, 260, { label: 'Regulator', max: 100 }),
      E('odorizer', 'gasnet.odorizer', 475, 260, { label: 'Odorizer', max: 100 }),
      E('meter_gas', 'gasnet.meter.gas', 565, 260, { label: 'Gas meter' }),
      E('tee_distribution', 'pipe.tee', 650, 260, { label: 'Distribution tee', labelPos: 'n', turn: '180' }),
      E('gasholder', 'gasnet.holder', 650, 140, { label: 'Gasholder', labelPos: 't', max: 100, valuePos: 'r' }),
      E('boiler', 'hvac.boiler', 790, 260, { label: 'Boiler' }),
      E('substation_heat', 'gasnet.substation.heat', 890, 260, { label: 'Substation' }),
      E('meter_heat', 'gasnet.meter.heat', 990, 260, { label: 'Heat meter' }),
      E('return_main', 'drain', 1085, 260, { label: 'Return main', medium: 'hot' }),
      E('radiators_floor_1', 'hvac.radiator', 890, 410, { turn: '90', label: 'Floor 1 radiators', medium: 'hot' }),
      E('radiators_floor_2', 'hvac.radiator', 890, 140, { label: 'Floor 2 radiators', turn: '90', labelPos: 'n', medium: 'hot' }),
    ],
    links: [
      L('valve_intake.r', 'filter_gas.l', 'pipe', { id: 'valve_intake' }),
      L('filter_gas.r', 'booster.l', 'pipe', { id: 'filter_gas' }),
      L('booster.r', 'regulator.l', 'pipe', { id: 'booster' }),
      L('regulator.r', 'odorizer.l', 'pipe', { id: 'regulator' }),
      L('odorizer.r', 'meter_gas.l', 'pipe', { id: 'odorizer' }),
      L('meter_gas.r', 'tee_distribution.l', 'pipe', { id: 'meter_gas' }),
      L('tee_distribution.t', 'gasholder.b', 'pipe', { id: 'tee_distribution' }),
      L('tee_distribution.r', 'boiler.l', 'pipe', { id: 'tee2' }),
      L('boiler.r', 'substation_heat.l', 'pipe', { id: 'boiler', ...HOT }),
      L('substation_heat.r', 'meter_heat.l', 'pipe', { id: 'substation_heat', ...HOT }),
      L('meter_heat.r', 'return_main.l', 'pipe', { id: 'meter_heat', ...HOT }),
      L('substation_heat.b', 'radiators_floor_1.t', 'pipe', { id: 'sec', ...HOT }),
      L('substation_heat.t', 'radiators_floor_2.b', 'pipe', { id: 'sec2', ...HOT }),
    ],
  },
  rows: [
    { id: 'valve_intake', running: true },
    { id: 'filter_gas', running: true, value: 78, status: 'warning', label: 'Filter · high ΔP' },
    { id: 'booster', running: true },
    { id: 'regulator', running: true, value: 55 },
    { id: 'odorizer', running: true, value: 64 },
    { id: 'meter_gas', running: true },
    { id: 'tee_distribution', running: true },
    { id: 'tee2', running: true },
    { id: 'gasholder', running: true, value: 62, label: 'Gasholder' },
    { id: 'boiler', running: true },
    { id: 'substation_heat', running: true },
    { id: 'meter_heat', running: true, value: 420 },
    { id: 'return_main', running: true },
    { id: 'radiators_floor_1', running: true },
    { id: 'radiators_floor_2', running: true },
    { id: 'sec', running: true },
    { id: 'sec2', running: true },
  ],
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Gas and district heating', [
  scene(SECTOR_SCENE, 9, 13),
  P('status', 'state', 'Station status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Gas station'), showSince: true }),
  P('pressure', 'gauge', 'Outlet pressure', 9, 3, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Outlet pressure', needle: true, $format: { unit: 'mbar' },
    ranges: [{ to: 40, color: BAD }, { from: 40, to: 60, color: OK }, { from: 60, to: 80, color: WARN }, { from: 80, color: BAD }],
  }),
  P('flow', 'stat.sparkline', 'Gas flow', 9, 7, 3, 3, { series: 'sample.power' }, { label: 'Gas flow', showChange: 'percent', fill: 'gradient', $format: { unit: 'm³/h', decimals: 0 } }),
  P('esd', 'control.switch', 'Intake valve', 9, 10, 3, 3, { value: 'sample.pump' }, { label: 'Intake valve open', icon: 'fas fa-fire-flame-simple', stateDisplay: 'pill' }),
  P('heat', 'chart.line', 'Heat power', 0, 13, 8, 6, { series: 'sample.temperature.series' }, { legend: 'none', $format: { unit: 'kW', decimals: 0 } }),
  P('events', 'data.feed', 'Station events', 8, 13, 4, 6, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
