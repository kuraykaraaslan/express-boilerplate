// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-appliance.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The "appliance" sample: the controllable appliances of a house as one floor plan with its readings, and the home control
// panel built around it (pure data). Rooms are zones; the appliances stand in them with their real names; the only pipe is
// the water heater to the radiator. Beside the plan sit the controls: switches, the thermostat target, two scenes, the home
// mode, today's energy, the power draw and the events.

import type { BoardDocument } from '../settings/board';
import { BAD, board, OK, P, scene, WARN } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;

const E = (id: string, symbol: string, x: number, y: number, extra: Elem = {}): Elem => ({ id, symbol, x, y, ...extra });
const L = (from: string, to: string, kind: string, extra: Elem = {}): Elem => ({ from, to, kind, ...extra });

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.appliance',
  title: 'Smart home',
  settings: {
    width: 1200, height: 668, scale: 0.7, background: 'dots', runningColor: 'var(--primary)',
    shapes: [
      { kind: 'text', x: 20, y: 30, text: 'Smart home · ground floor and garden', size: 'l', align: 'start' },
      { kind: 'zone', x: 10, y: 48, w: 460, h: 292, text: 'Living room', tone: 'info' },
      { kind: 'zone', x: 480, y: 48, w: 385, h: 292, text: 'Kitchen', tone: 'warning' },
      { kind: 'zone', x: 870, y: 48, w: 320, h: 292, text: 'Laundry and utility', tone: 'neutral' },
      { kind: 'zone', x: 10, y: 350, w: 380, h: 308, text: 'Bedroom', tone: 'info' },
      { kind: 'zone', x: 400, y: 350, w: 370, h: 308, text: 'Garage', tone: 'neutral' },
      { kind: 'zone', x: 780, y: 350, w: 410, h: 308, text: 'Garden', tone: 'success' },
    ],
    elements: [
      // living room
      E('air_conditioner', 'appliance.ac.split', 85, 125, { label: 'Air conditioner', medium: 'cold', decimals: 1 }),
      E('light_ceiling', 'appliance.light.ceiling', 190, 125, { label: 'Ceiling light', unit: '%', decimals: 0, showValue: false }),
      E('thermostat', 'appliance.thermostat', 285, 125, { label: 'Thermostat', min: 10, max: 30, decimals: 1 }),
      E('blinds_living', 'appliance.blinds', 380, 125, { label: 'Blinds', unit: '%', decimals: 0 }),
      E('lamp_floor', 'appliance.lamp.floor', 85, 250, { label: 'Floor lamp', unit: '%', decimals: 0, showValue: false }),
      E('television', 'home.tv', 190, 250, { label: 'Television', unit: '%', decimals: 0, showValue: false }),
      E('fan_tower', 'appliance.fan.tower', 285, 250, { label: 'Tower fan' }),
      E('smoke_detector', 'safety.detector.smoke', 380, 250, { label: 'Smoke detector', unit: '%', decimals: 0 }),
      // kitchen
      E('fridge', 'appliance.fridge', 540, 125, { label: 'Fridge', decimals: 0 }),
      E('oven', 'appliance.oven', 625, 125, { label: 'Oven', unit: '°C', decimals: 0 }),
      E('cooktop', 'appliance.cooktop', 710, 125, { label: 'Cooktop', showValue: false }),
      E('dishwasher', 'appliance.dishwasher', 795, 125, { label: 'Dishwasher', showValue: false }),
      E('microwave', 'appliance.microwave', 540, 250, { label: 'Microwave' }),
      E('coffee_machine', 'appliance.coffee', 625, 250, { label: 'Coffee', showValue: false }),
      E('kettle', 'appliance.kettle', 710, 250, { label: 'Kettle', unit: '°C', decimals: 0 }),
      E('robot_vacuum', 'appliance.vacuum.robot', 795, 250, { label: 'Robot vacuum', unit: '%', decimals: 0 }),
      // laundry and utility
      E('washer', 'appliance.washer', 915, 125, { label: 'Washer', unit: '%', decimals: 0 }),
      E('dryer', 'appliance.dryer', 1005, 125, { label: 'Dryer', showValue: false }),
      E('dehumidifier', 'appliance.dehumidifier', 1095, 125, { label: 'Dehumidifier', decimals: 0 }),
      E('water_heater', 'appliance.heater.water', 930, 250, { label: 'Water heater', decimals: 0 }),
      E('radiator', 'hvac.radiator', 1065, 250, { label: 'Radiator' }),
      // bedroom
      E('fan_ceiling', 'appliance.fan.ceiling', 70, 430, { label: 'Ceiling fan' }),
      E('humidifier', 'appliance.humidifier', 160, 430, { label: 'Humidifier', unit: '%', decimals: 0 }),
      E('heater_panel', 'appliance.heater.panel', 250, 430, { label: 'Panel heater', unit: '°C', decimals: 0 }),
      E('blinds_bedroom', 'appliance.blinds', 340, 430, { label: 'Blinds', unit: '%', decimals: 0 }),
      E('led_strip_bedside', 'appliance.light.strip', 95, 560, { label: 'Bedside LED strip', unit: '%', decimals: 0, showValue: false }),
      E('air_purifier', 'appliance.purifier', 200, 560, { label: 'Air purifier', unit: '%', decimals: 0 }),
      E('smart_plug', 'home.plug.smart', 290, 560, { label: 'Smart plug', unit: ' W', decimals: 0 }),
      // garage
      E('garage_door', 'appliance.garage', 455, 430, { label: 'Garage door', unit: '%', decimals: 0 }),
      E('ev_charger', 'appliance.wallbox', 545, 430, { label: 'EV charger', unit: '%', decimals: 0 }),
      E('door_lock', 'appliance.lock.smart', 635, 430, { label: 'Door lock' }),
      E('chest_freezer', 'appliance.freezer', 480, 560, { label: 'Chest freezer', decimals: 0 }),
      E('light_garage', 'appliance.light.ceiling', 580, 560, { label: 'Garage light', unit: '%', decimals: 0, showValue: false }),
      // garden
      E('robot_mower', 'appliance.mower.robot', 850, 430, { label: 'Robot mower', unit: '%', decimals: 0 }),
      E('irrigation', 'appliance.irrigation', 990, 430, { label: 'Irrigation', showValue: false }),
      E('lamp_garden', 'appliance.lamp.floor', 1120, 430, { label: 'Garden lamp', unit: '%', decimals: 0, showValue: false }),
      E('pool_pump', 'appliance.pool.pump', 880, 560, { label: 'Pool pump', unit: '%', decimals: 0 }),
    ],
    links: [
      L('water_heater.r', 'radiator.l', 'pipe', { medium: 'hot', id: 'water_heater', arrows: true }),
    ],
  },
  rows: [
    { id: 'air_conditioner', running: true, value: 26.4, value2: 22 },
    { id: 'light_ceiling', running: true, value: 80 },
    { id: 'thermostat', running: true, value: 24.5, value2: 22 },
    { id: 'blinds_living', running: false, value: 70 },
    { id: 'lamp_floor', running: true, value: 40 },
    { id: 'television', running: true, value: 24 },
    { id: 'fan_tower', running: false },
    { id: 'smoke_detector', running: true, value: 96 },
    { id: 'fridge', running: true, value: 9, status: 'warning' },
    { id: 'oven', running: true, value: 180 },
    { id: 'cooktop', running: true, value: 40 },
    { id: 'dishwasher', running: false, value: 100 },
    { id: 'microwave', running: false },
    { id: 'coffee_machine', running: false, value: 70, value2: 55 },
    { id: 'kettle', running: false, value: 23, value2: 60 },
    { id: 'robot_vacuum', running: true, value: 74 },
    { id: 'washer', running: true, value: 62, value2: 38 },
    { id: 'dryer', running: false, value: 0 },
    { id: 'dehumidifier', running: false, value: 58, value2: 30 },
    { id: 'water_heater', running: true, value: 58 },
    { id: 'radiator', running: true },
    { id: 'fan_ceiling', running: true },
    { id: 'humidifier', running: true, value: 46, value2: 60 },
    { id: 'heater_panel', running: false, value: 21 },
    { id: 'blinds_bedroom', running: false, value: 20 },
    { id: 'led_strip_bedside', running: true, value: 55 },
    { id: 'air_purifier', running: true, value: 82 },
    { id: 'smart_plug', running: true, value: 85 },
    { id: 'garage_door', running: false, value: 0 },
    { id: 'ev_charger', running: true, value: 64, value2: 7.4 },
    { id: 'door_lock', running: true },
    { id: 'chest_freezer', running: true, value: -18 },
    { id: 'light_garage', running: false, value: 0 },
    { id: 'robot_mower', running: true, value: 81 },
    { id: 'irrigation', running: false, value: 41 },
    { id: 'lamp_garden', running: true, value: 35 },
    { id: 'pool_pump', running: true, value: 70 },
  ],
};

/** The plan and, around it, what a person reaches for: the lights, the air conditioner, the vacuum, the target and the scenes. */
export const SECTOR_BOARD: BoardDocument | null = board('SCADA · Smart home', [
  scene(SECTOR_SCENE, 9, 10),
  P('mode', 'state', 'Home mode', 9, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Home mode',
    states: [
      { match: 'RUNNING', label: 'Home', color: OK, icon: 'fas fa-house-chimney', pulse: true },
      { match: 'STOPPED', label: 'Away', color: BAD, icon: 'fas fa-person-walking-arrow-right' },
      { match: 'IDLE', label: 'Night', color: WARN, icon: 'fas fa-moon' },
    ],
    showSince: true,
  }),
  P('energy', 'stat.value', 'Energy today', 9, 3, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Energy today', icon: 'fas fa-bolt', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday', $format: { unit: 'kWh', decimals: 1 },
  }),
  P('target', 'control.setpoint', 'Living room target', 9, 6, 3, 4, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Living room target', min: 16, max: 28, step: 0.5, $format: { unit: '°C', decimals: 1 },
  }),
  P('lights', 'control.switch', 'Lights', 0, 10, 3, 3, { value: 'sample.pump' }, { label: 'Lights', icon: 'fas fa-lightbulb', stateDisplay: 'pill' }),
  P('cooling', 'control.switch', 'Air conditioner', 3, 10, 3, 3, { value: 'sample.pump' }, { label: 'Air conditioner', icon: 'fas fa-snowflake', stateDisplay: 'pill' }),
  P('vacuum', 'control.switch', 'Robot vacuum', 6, 10, 3, 3, { value: 'sample.pump' }, { label: 'Robot vacuum', icon: 'fas fa-robot', stateDisplay: 'pill' }),
  P('night', 'control.button', 'Good night', 9, 10, 3, 2, {}, {
    label: 'Good night', icon: 'fas fa-moon', fullWidth: true, confirmQuestion: 'Switch off the lights and lock the doors?', confirmLabel: 'Good night',
  }),
  P('away', 'control.button', 'Away', 9, 12, 3, 2, {}, {
    label: 'Away', icon: 'fas fa-door-open', fullWidth: true, appearance: 'outlined', confirmQuestion: 'Switch the house to away mode?', confirmLabel: 'Leave',
  }),
  P('draw', 'stat.sparkline', 'Power draw', 9, 14, 3, 3, { series: 'sample.power' }, { label: 'Power draw', icon: 'fas fa-plug', increaseIs: 'bad', $format: { unit: 'W', decimals: 0 } }),
  P('indoor', 'chart.line', 'Living room temperature', 0, 13, 5, 5, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
  P('events', 'data.feed', 'Home events', 5, 13, 4, 5, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
]);
