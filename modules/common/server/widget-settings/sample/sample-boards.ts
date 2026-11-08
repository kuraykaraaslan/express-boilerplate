// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/sample-boards.ts). Kept when kui-react cut its SCADA library; NB changes it itself (docs/phases/07-dashboard/33-scada-and-3d-protection.md, 33.1).
// Five themed sample boards (pure), each bound to the sample data: what a real board for that job looks
// like, with settings a person would choose. The widget gallery shows them; next-boilerplate can create
// them as starting points. Every placement's settings pass its template unchanged (tests/sample-boards).

import type { BoardDocument, BoardPlacement } from '../settings/board';
import { SAMPLE_SCADA_BOARDS } from './scada-boards';

const P = (id: string, type: string, title: string, x: number, y: number, w: number, h: number, binding: Record<string, string>, settings: Record<string, unknown> = {}): BoardPlacement =>
  ({ id, type, title, x, y, w, h, settings, binding });

const board = (title: string, placements: BoardPlacement[]): BoardDocument =>
  ({ format: 'widgetkit.board', version: 1, templates: {}, board: { title, settings: {} }, placements });

const OK = 'var(--success)';
const WARN = 'var(--warning)';
const BAD = 'var(--error)';
const INFO = 'var(--info)';

/**
 * The process plant of kui-viewer's Coordination demo (three federated discipline models, served from
 * public/samples/plant/) with its sensors as live markers. Shared by the plant board and the gallery.
 */
export const PLANT_MODEL: Record<string, unknown> = {
  models: [
    { url: '/samples/plant/Plant-Structure.ifc', label: 'Structure', visible: true },
    { url: '/samples/plant/Plant-Process.ifc', label: 'Process', visible: true },
    { url: '/samples/plant/Plant-Utilities.ifc', label: 'Utilities', visible: true },
  ],
  labelColumn: 'id',
  tooltipColumns: ['label', 'measure'],
  valueColors: [
    { value: 'Normal', color: OK, label: 'Normal' },
    { value: 'Warning', color: WARN, label: 'Warning' },
    { value: 'Alarm', color: BAD, label: 'Alarm' },
  ],
};

/** A factory line: is it running, how hot, how much power, and the controls to act. */
export const SAMPLE_PLANT_BOARD = board('Plant operations', [
  P('status', 'state', 'Line 2', 0, 0, 3, 3, { value: 'sample.state' }, {
    label: 'Bursa · conveyor', showSince: true,
    states: [{ match: 'RUNNING', label: 'Running', color: OK, icon: 'fas fa-circle-check', pulse: true }, { match: 'STOPPED', label: 'Stopped', color: BAD, icon: 'fas fa-circle-xmark' }],
  }),
  P('temp', 'stat.value', 'Temperature', 3, 0, 3, 3, { value: 'sample.temperature', compare: 'sample.temperature.yesterday' }, {
    label: 'Hall average', icon: 'fas fa-temperature-half', increaseIs: 'bad', compareAs: 'delta', compareLabel: 'vs. yesterday',
    ranges: [{ from: 26, color: BAD }], $format: { unit: '°C', decimals: 1 },
  }),
  P('pump', 'control.switch', 'Coolant pump', 6, 0, 3, 3, { value: 'sample.pump' }, { label: 'Pump power', icon: 'fas fa-droplet', stateDisplay: 'pill' }),
  P('restart', 'control.button', 'Restart line', 9, 0, 3, 3, {}, {
    label: 'Restart', icon: 'fas fa-rotate-right', description: 'After a stop, restarts conveyor 2', fullWidth: true,
    confirmQuestion: 'Restart conveyor 2 now?', confirmLabel: 'Restart',
  }),
  P('model', 'viewer.model', 'Process plant (3D)', 0, 3, 8, 11, { sensors: 'sample.plant.sensors' }, PLANT_MODEL),
  P('load', 'gauge', 'Line load', 8, 3, 4, 6, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Capacity used', needle: true, $format: { unit: '%' },
    ranges: [{ to: 60, color: OK }, { from: 60, to: 85, color: WARN }, { from: 85, color: BAD }],
  }),
  P('setpoint', 'control.setpoint', 'Thermostat', 8, 9, 4, 5, { value: 'sample.setpoint' }, {
    layout: 'stepper', label: 'Target temperature', min: 16, max: 28, step: 0.5, $format: { unit: '°C', decimals: 1 },
  }),
  P('energy', 'stat.sparkline', 'Hall temperature', 0, 14, 8, 3, { series: 'sample.temperature.series' }, {
    label: 'Last 12 hours', showChange: 'delta', increaseIs: 'bad', fill: 'gradient', showMinMax: true, $format: { unit: '°C', decimals: 1 },
  }),
  P('fan', 'control.slider', 'Extractor fan', 8, 14, 4, 3, { value: 'sample.cpu' }, { label: 'Speed', startIcon: 'fas fa-fan', tickMarks: 5, $format: { unit: '%' } }),
  P('climate', 'chart.line', 'Climate', 0, 17, 8, 7, { series: 'sample.climate' }, {
    series: [{ key: 'Temperature', unit: '°C', decimals: 1 }, { key: 'Humidity', unit: '%', decimals: 0, axis: 'right', lineStyle: 'dashed' }],
    thresholds: [{ value: 24, label: 'Too warm', color: BAD, style: 'dashed', width: 1 }], legendValues: ['latest', 'max'],
  }),
  P('events', 'data.feed', 'Line events', 8, 17, 4, 7, { events: 'sample.events' }, { layout: 'timeline', maxItems: 5 }),
  P('power', 'chart.area', 'Power draw', 0, 24, 12, 7, { series: 'sample.power' }, { stacked: true, fill: 'soft', legendValues: ['latest', 'avg'], $format: { unit: 'kW' } }),
]);

/** A shop: how today compares, where orders come from, what sells. */
export const SAMPLE_SALES_BOARD = board('Sales overview', [
  P('orders', 'stat.value', 'Orders', 0, 0, 3, 3, { value: 'sample.orders', compare: 'sample.orders.yesterday' }, {
    label: 'Today', icon: 'fas fa-cart-shopping', increaseIs: 'good', compareLabel: 'vs. yesterday',
  }),
  P('visitors', 'stat.sparkline', 'Visitors', 3, 0, 3, 3, { series: 'sample.visitors.series' }, {
    label: 'Last 14 days', showChange: 'percent', increaseIs: 'good', fill: 'gradient', $format: { notation: 'compact' },
  }),
  P('conversion', 'stat.value', 'Conversion', 6, 0, 3, 3, { value: 'sample.conversion', compare: 'sample.conversion.yesterday' }, {
    label: 'Visitors who ordered', icon: 'fas fa-percent', iconColor: INFO, increaseIs: 'good', compareAs: 'delta', compareLabel: 'vs. yesterday',
    $format: { unit: '%', decimals: 1 },
  }),
  P('aov', 'stat.value', 'Average order', 9, 0, 3, 3, { value: 'sample.aov' }, {
    label: 'Per order today', icon: 'fas fa-receipt', iconColor: 'var(--primary)', $format: { unit: '₺', unitPosition: 'before', decimals: 2 },
  }),
  P('revenue', 'chart.bar', 'Daily revenue', 0, 3, 8, 7, { series: 'sample.revenue' }, {
    barRadius: 4, legend: 'none', $format: { unit: '₺', unitPosition: 'before', notation: 'compact' },
    thresholds: [{ value: 15000, label: 'Daily target', color: OK, style: 'dashed', width: 1.5 }],
  }),
  P('goal', 'progress', 'Monthly target', 8, 3, 4, 3, { value: 'sample.goal.done', target: 'sample.goal.target' }, {
    label: 'Sales this month', icon: 'fas fa-flag-checkered', valueText: 'both', $format: { unit: '₺', unitPosition: 'before', notation: 'compact' },
    ranges: [{ to: 50, color: BAD }, { from: 50, to: 80, color: WARN }, { from: 80, color: OK }],
  }),
  P('channels', 'chart.pie', 'Orders by channel', 8, 6, 4, 7, { slices: 'sample.channels' }, { layout: 'donut-total', totalLabel: 'Orders', legendValue: 'percent' }),
  P('products', 'data.table', 'Best sellers', 0, 10, 8, 8, { rows: 'sample.products' }, {
    defaultSort: 'sold', defaultSortDir: 'desc', search: true,
    columns: [
      { key: 'product' },
      { key: 'category', cell: 'badge', valueMap: [{ value: 'Climate', color: INFO }, { value: 'Security', color: 'var(--primary)' }, { value: 'Energy', color: OK }, { value: 'Networking', color: WARN }] },
      { key: 'sold', align: 'end' },
      { key: 'revenue', align: 'end', unit: '₺', decimals: 0 },
      { key: 'stock', label: 'In stock', align: 'end', decimals: 0, ranges: [{ to: 20, color: BAD }] },
    ],
  }),
  P('regions', 'chart.pie', 'Revenue by region', 8, 13, 4, 5, { slices: 'sample.regions' }, { layout: 'pie', valueLabels: 'percent', legend: 'right' }),
  P('traffic', 'heatmap', 'Visits by weekday and hour', 0, 18, 12, 7, { cells: 'sample.traffic' }, { valueName: 'Visits' }),
]);

/** A site's energy: what it uses, what the sun gives, what it emits. */
export const SAMPLE_ENERGY_BOARD = board('Energy and environment', [
  P('used', 'stat.value', 'Energy used', 0, 0, 3, 3, { value: 'sample.energy.today', compare: 'sample.energy.yesterday' }, {
    label: 'Today', icon: 'fas fa-bolt', iconColor: WARN, increaseIs: 'bad', compareLabel: 'vs. yesterday', $format: { unit: 'kWh' },
  }),
  P('co2', 'stat.value', 'CO₂', 3, 0, 3, 3, { value: 'sample.co2' }, {
    label: 'Emitted today', icon: 'fas fa-leaf', iconColor: OK, $format: { unit: 't', decimals: 2 },
  }),
  P('storage', 'gauge', 'Battery storage', 6, 0, 3, 6, { value: 'sample.storage' }, {
    layout: 'donut', label: 'Charge', $format: { unit: '%' },
    ranges: [{ to: 20, color: BAD }, { from: 20, to: 40, color: WARN }, { from: 40, color: OK }],
  }),
  P('temp', 'stat.sparkline', 'Indoor temperature', 9, 0, 3, 3, { series: 'sample.temperature.series' }, {
    label: 'Last 12 hours', showChange: 'delta', increaseIs: 'neutral', fill: 'gradient', $format: { unit: '°C', decimals: 1 },
  }),
  P('target', 'progress', 'Saving target', 0, 3, 6, 3, { value: 'sample.goal.done', target: 'sample.goal.target' }, {
    label: 'Savings this year', icon: 'fas fa-piggy-bank', valueText: 'percent', $format: { unit: '₺', unitPosition: 'before', notation: 'compact' },
  }),
  P('thermostat', 'control.setpoint', 'Thermostat', 9, 3, 3, 3, { value: 'sample.setpoint' }, { layout: 'stepper', min: 16, max: 28, step: 0.5, $format: { unit: '°C', decimals: 1 } }),
  P('solar', 'chart.area', 'Solar and grid', 0, 6, 8, 7, { series: 'sample.solar' }, {
    series: [{ key: 'Solar', color: WARN }, { key: 'Grid', color: INFO }], stacked: true, fill: 'medium', legendValues: ['latest', 'total'], $format: { unit: 'kW' },
  }),
  P('split', 'chart.pie', 'Energy by consumer', 8, 6, 4, 7, { slices: 'sample.energy.split' }, { layout: 'donut-total', totalLabel: 'kWh', legendValue: 'percent' }),
  P('climate', 'chart.line', 'Climate', 0, 13, 8, 7, { series: 'sample.climate' }, {
    series: [{ key: 'Temperature', unit: '°C', decimals: 1 }, { key: 'Humidity', unit: '%', decimals: 0, axis: 'right', lineStyle: 'dashed' }],
  }),
  P('meter', 'stat.attributes', 'Main meter', 8, 13, 4, 7, { record: 'sample.device' }, {
    fields: [{ key: 'model' }, { key: 'serialNumber', label: 'Serial' }, { key: 'firmware' }, { key: 'site' }, { key: 'uptimeHours', label: 'Uptime', unit: 'h' }],
  }),
]);

/** A platform's health: is it up, how fast, what is failing. */
export const SAMPLE_INFRA_BOARD = board('Infrastructure health', [
  P('status', 'state', 'Platform', 0, 0, 3, 3, { value: 'sample.incident' }, {
    label: 'Overall status', layout: 'badge', showSince: true,
    states: [
      { match: 'OPERATIONAL', label: 'Operational', color: OK, icon: 'fas fa-circle-check' },
      { match: 'DEGRADED', label: 'Degraded', color: WARN, icon: 'fas fa-triangle-exclamation', pulse: true },
      { match: 'OUTAGE', label: 'Outage', color: BAD, icon: 'fas fa-circle-xmark' },
    ],
  }),
  P('uptime', 'stat.value', 'Uptime', 3, 0, 3, 3, { value: 'sample.uptime' }, {
    label: 'This month', icon: 'fas fa-server', ranges: [{ to: 99.5, color: BAD }, { from: 99.5, to: 99.9, color: WARN }, { from: 99.9, color: OK }],
    rangeTarget: 'icon', $format: { unit: '%', decimals: 2 },
  }),
  P('errors', 'stat.value', 'Errors', 6, 0, 3, 3, { value: 'sample.errors', compare: 'sample.errors.before' }, {
    label: 'Last hour', icon: 'fas fa-bug', iconColor: BAD, increaseIs: 'bad', compareLabel: 'vs. the hour before',
  }),
  P('memory', 'stat.sparkline', 'Memory', 9, 0, 3, 3, { series: 'sample.memory.series' }, {
    label: 'Cluster average', fill: 'gradient', ranges: [{ from: 85, color: BAD }], $format: { unit: '%' },
  }),
  P('requests', 'chart.line', 'Traffic', 0, 3, 8, 7, { series: 'sample.requests' }, {
    series: [{ key: 'Requests', unit: 'req/min' }, { key: 'Errors', axis: 'right', color: BAD, lineStyle: 'dashed' }], y2Label: 'Errors', legendValues: ['latest', 'max'],
  }),
  P('cpu', 'gauge', 'CPU', 8, 3, 4, 7, { value: 'sample.cpu' }, {
    layout: 'arc', label: 'Cluster load', $format: { unit: '%' },
    ranges: [{ to: 60, color: OK }, { from: 60, to: 85, color: WARN }, { from: 85, color: BAD }],
  }),
  P('services', 'data.table', 'Services', 0, 10, 8, 8, { rows: 'sample.services' }, {
    dateFormat: 'relative',
    columns: [
      { key: 'service' },
      { key: 'status', cell: 'badge', valueMap: [{ value: 'Healthy', color: OK }, { value: 'Degraded', color: WARN }, { value: 'Down', color: BAD }] },
      { key: 'region', visible: 'desktop' },
      { key: 'latency', align: 'end', unit: 'ms', ranges: [{ from: 500, color: BAD }] },
      { key: 'errorRate', align: 'end', unit: '%', decimals: 2, ranges: [{ from: 1, color: BAD }] },
      { key: 'deployedAt', align: 'end' },
    ],
  }),
  P('incidents', 'data.feed', 'Recent events', 8, 10, 4, 8, { events: 'sample.events' }, { layout: 'list', maxItems: 6 }),
  P('latency', 'chart.histogram', 'Response times', 0, 18, 6, 7, { values: 'sample.response' }, { showMean: true, showMedian: true, $format: { unit: 'ms' } }),
  P('scatter', 'chart.scatter', 'Load vs. temperature', 6, 18, 6, 7, { points: 'sample.scatter' }, { groupColumn: 'group', xUnit: '%', yUnit: '°C', trendLine: true }),
]);

/** Where the devices are and what state they are in. */
export const SAMPLE_SITES_BOARD = board('Sites and devices', [
  P('map', 'map', 'Sites', 0, 0, 8, 10, { points: 'sample.sites', zones: 'sample.zones', routes: 'sample.routes' }, { tooltipColumns: ['devices', 'uptime'], legend: true, zoneVariantColumn: 'state' }),
  P('device', 'stat.attributes', 'Selected device', 8, 0, 4, 5, { record: 'sample.device' }, {
    fields: [{ key: 'model' }, { key: 'firmware' }, { key: 'site' }, { key: 'temperature', unit: '°C', ranges: [{ from: 26, color: BAD }] }, { key: 'battery', unit: '%', ranges: [{ to: 20, color: BAD }] }],
  }),
  P('links', 'content.links', 'Shortcuts', 8, 5, 4, 5, {}, {
    layout: 'list',
    links: [
      { label: 'Devices', href: '/devices', description: 'Every registered device', icon: 'fas fa-microchip' },
      { label: 'Alerts', href: '/alerts', description: 'Open alerts', icon: 'fas fa-bell' },
      { label: 'Documentation', href: 'https://example.com/docs', description: 'How the platform works', icon: 'fas fa-book' },
    ],
  }),
  P('devices', 'data.table', 'Devices', 0, 10, 8, 8, { rows: 'sample.devices' }, {
    $format: { decimals: 1 },
    columns: [
      { key: 'name' },
      { key: 'site', visible: 'desktop' },
      { key: 'status', cell: 'badge', valueMap: [{ value: 'Online', color: OK }, { value: 'Warning', color: WARN }, { value: 'Offline', color: BAD }] },
      { key: 'temperature', label: 'Temp', unit: '°C' },
      { key: 'battery', label: 'Battery', cell: 'progress', decimals: 0, ranges: [{ to: 25, color: BAD }, { from: 25, to: 50, color: WARN }, { from: 50, color: OK }] },
      { key: 'lastSeen', align: 'end' },
    ],
  }),
  P('feed', 'data.feed', 'Recent events', 8, 10, 4, 8, { events: 'sample.events' }),
  P('note', 'content.markdown', 'About this site', 0, 18, 4, 6, { record: 'sample.device' }, {
    content: '### Istanbul Plant\n\nThe **{{model}}** gateway runs firmware **v{{firmware}}** and has been up for **{{uptimeHours}} h**.\n\n- Check the coolant level every shift\n- Report alarms to the line lead',
  }),
  P('photo', 'content.image', 'Plant floor', 4, 18, 4, 6, {}, {
    src: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1200', alt: 'A factory floor with machines', caption: 'Bursa Line 2',
  }),
  P('osm', 'content.embed', 'Area map', 8, 18, 4, 6, {}, { url: 'https://www.openstreetmap.org/export/embed.html?bbox=28.9,40.95,29.1,41.05&layer=mapnik' }),
]);

/** The themed boards, in the order a person would look at them. */
export const SAMPLE_BOARDS: readonly BoardDocument[] = [
  SAMPLE_PLANT_BOARD, SAMPLE_SALES_BOARD, SAMPLE_ENERGY_BOARD, SAMPLE_INFRA_BOARD, SAMPLE_SITES_BOARD, ...SAMPLE_SCADA_BOARDS,
];
