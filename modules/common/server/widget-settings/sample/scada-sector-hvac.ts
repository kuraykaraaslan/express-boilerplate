// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-hvac.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "hvac" sector sample: a building's plant room, air handling unit and zones as one process diagram with its
// readings, and the board built around it (pure data). Chilled water and heating water run in pipes (cold / hot),
// air runs in ducts, room thermostats talk to the VAV boxes and the fan coil over signal wires.

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

const AIR = { medium: 'custom', mediumColor: 'var(--info)' };
const OUTDOOR = { medium: 'custom', mediumColor: 'var(--text-secondary)' };

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.hvac',
  title: 'Building HVAC',
  settings: {
    width: 1330, height: 720, scale: 0.65, background: 'dots',
    // Rules: the chiller goes passive when the board parameter `mode` is off, the heating valve closes with the boiler,
    // the meeting room sensor turns amber above 24 degrees, and the boiler's name carries its temperature.
    rules: [
      { target: 'chiller', source: 'param', key: 'mode', op: 'eq', value: 'off', state: 'off', label: 'Chiller (off)' },
      { target: 'valve_heating', key: 'running', of: 'boiler', op: 'false', state: 'off' },
      { target: 'sensor_room_2', key: 'value', op: 'gt', value: '24', color: 'var(--warning)' },
      { target: 'boiler', key: 'value', op: 'set', label: 'Heating boiler {value}' },
    ],
    shapes: [
      { kind: 'text', x: 20, y: 30, text: 'Office building · HVAC', size: 'l', align: 'start' },
      { kind: 'zone', x: 10, y: 56, w: 590, h: 650, text: 'Plant room', tone: 'neutral' },
      { kind: 'zone', x: 612, y: 56, w: 700, h: 296, text: 'Air handling', tone: 'info' },
      { kind: 'zone', x: 612, y: 396, w: 360, h: 310, text: 'Lobby · hot water terminals', tone: 'warning' },
      { kind: 'zone', x: 985, y: 340, w: 180, h: 366, tone: 'info' },
      { kind: 'zone', x: 1172, y: 340, w: 140, h: 366, tone: 'info' },
      { kind: 'text', x: 1075, y: 692, text: 'Open office · VAV 1', size: 's', align: 'middle' },
      { kind: 'text', x: 1242, y: 692, text: 'Meeting · VAV 2', size: 's', align: 'middle' },
      { kind: 'text', x: 622, y: 218, text: 'Outdoor air', size: 's', align: 'middle' },
      { kind: 'text', x: 960, y: 302, text: 'Air handling unit', size: 's', align: 'middle' },
      { kind: 'text', x: 688, y: 308, text: 'Heat recovery', size: 's', align: 'middle' },
      { kind: 'text', x: 20, y: 676, text: 'Heating loop', size: 's', align: 'start' },
      { kind: 'text', x: 20, y: 356, text: 'Chilled water loop', size: 's', align: 'start' },
    ],
    elements: [
      // chilled water loop (y = 130), its return along y = 380
      E('chiller', 'hvac.chiller', 170, 130, { label: 'Air-cooled chiller' }),
      E('pumps_chilled', 'hvac.pump.twin', 360, 130, { label: 'Chilled water pumps' }),
      E('buffer_tank', 'hvac.thermal.storage', 520, 130, { label: 'Buffer tank', min: 0, max: 100 }),
      E('elbow_chilled_1', 'pipe.elbow', 850, 380, { label: 'Chilled water elbow 1', labelPos: 'n', turn: '90' }),
      E('elbow_chilled_2', 'pipe.elbow', 40, 380, { label: 'Chilled water elbow 2', labelPos: 'n', turn: '180' }),
      E('elbow_chilled_3', 'pipe.elbow', 40, 130, { label: 'Chilled water elbow 3', labelPos: 'n', turn: '270' }),
      // heating loop (y = 520), its return along y = 640
      E('boiler', 'hvac.boiler', 150, 520, { label: 'Heating boiler' }),
      E('pumps_heating', 'hvac.pump.twin', 300, 520, { label: 'Heating pumps' }),
      E('valve_heating', 'valve.ball', 450, 520, { label: 'Valve' }),
      E('radiator', 'hvac.radiator', 700, 520, { label: 'Radiator' }),
      E('fan_coil', 'hvac.fancoil', 830, 520, { label: 'Fan coil' }),
      E('sensor_room_fancoil', 'hvac.room.sensor', 770, 455, { label: 'Fan coil room sensor', labelPos: 'n' }),
      E('elbow_heating_1', 'pipe.elbow', 944, 520, { label: 'Heating elbow 1', labelPos: 'n' }),
      E('elbow_heating_2', 'pipe.elbow', 944, 640, { label: 'Heating elbow 2', labelPos: 'n', turn: '90' }),
      E('elbow_heating_3', 'pipe.elbow', 40, 640, { label: 'Heating elbow 3', labelPos: 'n', turn: '180' }),
      E('elbow_heating_4', 'pipe.elbow', 40, 520, { label: 'Heating elbow 4', labelPos: 'n', turn: '270' }),
      // air: outdoor air, heat recovery, AHU, supply main with two VAV branches
      E('damper', 'hvac.damper', 622.5, 250, { label: 'Damper', labelPos: 'n', showValue: false, ...OUTDOOR }),
      E('heat_recovery', 'hvac.heat.recovery', 687.5, 250, { label: 'Heat recovery', labelPos: 'n', ...OUTDOOR }),
      E('duct_intake', 'hvac.duct.straight', 752.5, 250, { label: 'Intake duct', labelPos: 'n', length: '1', ...OUTDOOR }),
      E('air_handling_unit', 'hvac.ahu', 850, 250, { label: 'Air handling unit', labelPos: 'n' }),
      E('duct_supply', 'hvac.duct.straight', 980, 250, { label: 'Supply duct', labelPos: 'n', length: '2', ...AIR }),
      E('duct_tee', 'hvac.duct.tee', 1077.5, 250, { label: 'Duct tee', labelPos: 'n', ...AIR }),
      E('duct_branch', 'hvac.duct.straight', 1142.5, 250, { label: 'Branch duct', labelPos: 'n', length: '1', ...AIR }),
      E('duct_elbow', 'hvac.duct.elbow', 1207.5, 250, { label: 'Duct elbow', labelPos: 'n', ...AIR }),
      E('duct_drop_1', 'hvac.duct.straight', 1077.5, 315, { label: 'Drop duct 1', labelPos: 'n', turn: '90', ...AIR }),
      E('vav_1', 'hvac.vav', 1077.5, 380, { label: 'VAV box 1', turn: '90', labelPos: 'n', showValue: false, min: 0, max: 100, ...AIR }),
      E('duct_outlet_1', 'hvac.duct.straight', 1077.5, 445, { label: 'Outlet duct 1', labelPos: 'n', turn: '90', ...AIR }),
      E('sensor_room_1', 'hvac.room.sensor', 1029, 560, { label: 'Room sensor 1', labelPos: 'n' }),
      E('duct_drop_2', 'hvac.duct.straight', 1207.5, 315, { label: 'Drop duct 2', labelPos: 'n', turn: '90', ...AIR }),
      E('vav_2', 'hvac.vav', 1207.5, 380, { label: 'VAV box 2', turn: '90', labelPos: 'n', showValue: false, min: 0, max: 100, ...AIR }),
      E('duct_outlet_2', 'hvac.duct.straight', 1207.5, 445, { label: 'Outlet duct 2', labelPos: 'n', turn: '90', ...AIR }),
      E('sensor_room_2', 'hvac.room.sensor', 1256, 560, { label: 'Room sensor 2', labelPos: 'n' }),
    ],
    links: [
      // chilled water: chiller > pumps > buffer tank > AHU coil, and back
      L('chiller.r', 'pumps_chilled.l', 'pipe', { medium: 'cold', id: 'chiller' }),
      L('pumps_chilled.r', 'buffer_tank.l', 'pipe', { medium: 'cold', id: 'pumps_chilled' }),
      L('buffer_tank.r', 'air_handling_unit.t', 'pipe', { medium: 'cold', id: 'pumps_chilled', arrows: true }),
      L('air_handling_unit.b', 'elbow_chilled_1.t', 'pipe', { medium: 'cold', id: 'pumps_chilled' }),
      L('elbow_chilled_1.l', 'elbow_chilled_2.r', 'pipe', { medium: 'cold', id: 'pumps_chilled' }),
      L('elbow_chilled_2.t', 'elbow_chilled_3.b', 'pipe', { medium: 'cold', id: 'pumps_chilled' }),
      L('elbow_chilled_3.r', 'chiller.l', 'pipe', { medium: 'cold', id: 'pumps_chilled' }),
      // heating water: boiler > pumps > valve > radiator > fan coil, and back
      L('boiler.r', 'pumps_heating.l', 'pipe', { medium: 'hot', id: 'boiler' }),
      L('pumps_heating.r', 'valve_heating.l', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      L('valve_heating.r', 'radiator.l', 'pipe', { medium: 'hot', id: 'pumps_heating', arrows: true }),
      L('radiator.r', 'fan_coil.l', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      L('fan_coil.r', 'elbow_heating_1.l', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      L('elbow_heating_1.b', 'elbow_heating_2.t', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      L('elbow_heating_2.l', 'elbow_heating_3.r', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      L('elbow_heating_3.t', 'elbow_heating_4.b', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      L('elbow_heating_4.r', 'boiler.l', 'pipe', { medium: 'hot', id: 'pumps_heating' }),
      // room thermostats
      L('sensor_room_1.t', 'vav_1.l', 'wire', { id: 'sensor_room_1' }),
      L('sensor_room_2.t', 'vav_2.r', 'wire', { id: 'sensor_room_2' }),
      L('sensor_room_fancoil.r', 'fan_coil.t', 'wire', { id: 'sensor_room_fancoil' }),
    ],
  },
  rows: merge(
    on('chiller', 'pumps_chilled', 'buffer_tank', 'elbow_chilled_1', 'elbow_chilled_2', 'elbow_chilled_3', 'boiler', 'pumps_heating', 'valve_heating', 'radiator', 'fan_coil', 'elbow_heating_1', 'elbow_heating_2', 'elbow_heating_3', 'elbow_heating_4', 'damper', 'heat_recovery', 'duct_intake', 'air_handling_unit', 'duct_supply', 'duct_tee', 'duct_branch', 'duct_elbow', 'duct_drop_1', 'vav_1', 'duct_outlet_1', 'duct_drop_2', 'vav_2', 'duct_outlet_2', 'sensor_room_1', 'sensor_room_2', 'sensor_room_fancoil'),
    [
    { id: 'pumps_chilled', running: true, value2: 0 },
    { id: 'pumps_heating', running: true, value2: 1 },
    { id: 'buffer_tank', running: true, value: 24, label: 'Buffer tank' },
    { id: 'boiler', running: true, value: 68, label: 'Heating boiler' },
    { id: 'damper', running: true, value: 80 },
    { id: 'vav_1', running: true, value: 62 },
    { id: 'vav_2', running: true, value: 35, status: 'warning' },
    { id: 'sensor_room_1', running: true, value: 21.5 },
    { id: 'sensor_room_2', running: true, value: 24.2, status: 'warning' },
    { id: 'sensor_room_fancoil', running: true, value: 20.8 },
    ],
  ),
};

/** The plant, the air handling unit and the zones, with what an operator keeps beside them. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Building HVAC', [
  scene(SECTOR_SCENE, 9, 10),
  P('status', 'state', 'Plant status', 9, 0, 3, 3, { value: 'sample.state' }, { ...RUNNING_STATES('Plant'), showSince: true }),
  P('supply', 'stat.value', 'Supply air', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Supply air', icon: 'fas fa-temperature-half', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: '°C', decimals: 1 },
  }),
  P('load', 'gauge', 'Chiller load', 9, 6, 3, 4, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Cooling load', needle: true, $format: { unit: '%' },
    ranges: [{ to: 70, color: OK }, { from: 70, to: 90, color: WARN }, { from: 90, color: BAD }],
  }),
  P('target', 'control.setpoint', 'Room set point', 0, 10, 4, 5, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Open office target', min: 16, max: 28, step: 0.5, $format: { unit: '°C', decimals: 1 },
  }),
  P('zone', 'chart.line', 'Zone temperature', 4, 10, 5, 5, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'HVAC alarms', 9, 10, 3, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 4 }),
]);
