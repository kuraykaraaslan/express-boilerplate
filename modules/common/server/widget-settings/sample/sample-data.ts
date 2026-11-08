// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/sample-data.ts). Kept when kui-react cut its SCADA library; NB changes it itself (docs/phases/07-dashboard/33-scada-and-3d-protection.md, 33.1).
// Sample data for every widget shape (pure). A board can be built and judged before real data exists:
// kui-react's widget gallery binds every builtin to these, and next-boilerplate serves them as the
// "Sample data" source. Deterministic per call time (a seeded generator), so screenshots are stable
// in shape while the timestamps follow "now".

import type { SlotData } from '../kind';
import type { BoardDocument, BoardPlacement } from '../settings/board';
import { PLANT_MODEL } from './sample-boards';
import { POOL_SCENE, scadaSources } from './scada-scenes';

export interface SampleSource {
  key: string;
  label: string;
  data: SlotData;
}

/** A small seeded generator (mulberry32): the same seed gives the same sequence. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** `points` evenly spaced up to `now`, `stepMin` minutes apart, from a smooth walk. */
function walk(seed: number, now: number, points: number, stepMin: number, base: number, swing: number, d = 1) {
  const r = rng(seed);
  let v = base;
  const out: Array<{ t: string; v: number }> = [];
  for (let i = points - 1; i >= 0; i--) {
    v += (r() - 0.5) * swing + Math.sin((points - i) / 4) * swing * 0.15;
    out.push({ t: new Date(now - i * stepMin * 60_000).toISOString(), v: round(v, d) });
  }
  return out;
}

const SITES = [
  { name: 'Istanbul Plant', lat: 41.0082, lng: 28.9784 },
  { name: 'Ankara Warehouse', lat: 39.9334, lng: 32.8597 },
  { name: 'Izmir Port', lat: 38.4237, lng: 27.1428 },
  { name: 'Bursa Line 2', lat: 40.1885, lng: 29.061 },
  { name: 'Antalya Depot', lat: 36.8969, lng: 30.7133 },
  { name: 'Konya Hub', lat: 37.8746, lng: 32.4932 },
  { name: 'Kayseri Workshop', lat: 38.7205, lng: 35.4826 },
];

/** Every sample source, its data computed for `now`. */
export function sampleSources(now = Date.now()): SampleSource[] {
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const r = rng(42);
  const temperature = walk(1, now, 48, 15, 21, 1.6);
  const humidity = walk(2, now, 48, 15, 48, 3);
  const power = walk(3, now, 48, 15, 320, 40, 0);
  const revenue = walk(4, now, 30, 24 * 60, 12000, 2400, 0).map((p) => ({ ...p, v: Math.max(4000, p.v) }));
  const lastT = temperature[temperature.length - 1].v;
  const statuses = ['Online', 'Online', 'Online', 'Warning', 'Online', 'Offline', 'Online'];
  const tones = ['success', 'success', 'success', 'warning', 'success', 'error', 'success'];

  return [
    // ── scalars
    { key: 'sample.temperature', label: 'Sample · Temperature now (°C)', data: { shape: 'scalar', value: lastT, meta: { label: 'Temperature', unit: '°C', decimals: 1, kind: 'number' }, fetchedAt: at(0) } },
    { key: 'sample.temperature.yesterday', label: 'Sample · Temperature yesterday (°C)', data: { shape: 'scalar', value: round(lastT - 1.4), fetchedAt: at(0) } },
    { key: 'sample.orders', label: 'Sample · Orders today', data: { shape: 'scalar', value: 1284, meta: { label: 'Orders today', decimals: 0, kind: 'number', direction: 'higherIsBetter' }, fetchedAt: at(1) } },
    { key: 'sample.orders.yesterday', label: 'Sample · Orders yesterday', data: { shape: 'scalar', value: 1147, fetchedAt: at(1) } },
    { key: 'sample.cpu', label: 'Sample · CPU load (%)', data: { shape: 'scalar', value: 67, meta: { label: 'CPU load', unit: '%', decimals: 0, kind: 'number', direction: 'lowerIsBetter' }, fetchedAt: at(0) } },
    { key: 'sample.goal.done', label: 'Sample · Sales this month', data: { shape: 'scalar', value: 74250, fetchedAt: at(2) } },
    { key: 'sample.goal.target', label: 'Sample · Sales target', data: { shape: 'scalar', value: 100000, fetchedAt: at(2) } },
    { key: 'sample.state', label: 'Sample · Line status', data: { shape: 'scalar', value: 'RUNNING', meta: { label: 'Line status', kind: 'enum', valueMap: { RUNNING: { label: 'Running', color: 'var(--success)' }, STOPPED: { label: 'Stopped', color: 'var(--error)' }, IDLE: { label: 'Idle', color: 'var(--warning)' } } }, fetchedAt: at(0) } },
    { key: 'sample.pump', label: 'Sample · Pump on', data: { shape: 'scalar', value: true, fetchedAt: at(0) } },
    { key: 'sample.setpoint', label: 'Sample · Thermostat set point (°C)', data: { shape: 'scalar', value: 22, fetchedAt: at(0) } },
    // ── series
    { key: 'sample.climate', label: 'Sample · Temperature and humidity (12 h)', data: { shape: 'series', series: [{ name: 'Temperature', points: temperature }, { name: 'Humidity', points: humidity }], fetchedAt: at(0) } },
    { key: 'sample.temperature.series', label: 'Sample · Temperature (12 h)', data: { shape: 'series', series: [{ name: 'Temperature', points: temperature, meta: { unit: '°C', decimals: 1, kind: 'number' } }], fetchedAt: at(0) } },
    { key: 'sample.power', label: 'Sample · Power draw (kW, 12 h)', data: { shape: 'series', series: [{ name: 'Line 1', points: power }, { name: 'Line 2', points: walk(5, now, 48, 15, 260, 35, 0) }], fetchedAt: at(0) } },
    { key: 'sample.revenue', label: 'Sample · Daily revenue (30 d)', data: { shape: 'series', series: [{ name: 'Revenue', points: revenue }], fetchedAt: at(5) } },
    // ── tables
    {
      key: 'sample.devices', label: 'Sample · Devices',
      data: {
        shape: 'table', fetchedAt: at(1),
        columns: [
          { key: 'name', label: 'Device', type: 'text' }, { key: 'site', label: 'Site', type: 'text' },
          {
            key: 'status', label: 'Status', type: 'text', kind: 'enum',
            valueMap: { Online: { label: 'Online', color: 'var(--success)' }, Warning: { label: 'Warning', color: 'var(--warning)' }, Offline: { label: 'Offline', color: 'var(--error)' } },
          },
          { key: 'temperature', label: 'Temp', type: 'number', unit: '°C', decimals: 1, kind: 'number' },
          { key: 'battery', label: 'Battery', type: 'number', unit: '%', decimals: 0, kind: 'number', direction: 'higherIsBetter' },
          { key: 'lastSeen', label: 'Last seen', type: 'date' },
        ],
        rows: SITES.map((s, i) => ({
          id: `dev-${i + 1}`, name: `Sensor ${String.fromCharCode(65 + i)}${i + 1}`, site: s.name, status: statuses[i],
          temperature: round(18 + r() * 9), battery: Math.round(20 + r() * 80), lastSeen: at(Math.round(r() * 240)),
        })),
      },
    },
    {
      key: 'sample.sites', label: 'Sample · Sites on the map',
      data: {
        shape: 'table', fetchedAt: at(1),
        columns: [
          { key: 'lat', label: 'Latitude', type: 'number' }, { key: 'lng', label: 'Longitude', type: 'number' },
          { key: 'label', label: 'Site', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
          { key: 'color', label: 'Tone', type: 'badge' }, { key: 'id', label: 'Id', type: 'text' },
          { key: 'devices', label: 'Devices', type: 'number' }, { key: 'uptime', label: 'Uptime (%)', type: 'number' },
        ],
        rows: SITES.map((s, i) => ({
          lat: s.lat, lng: s.lng, label: s.name, status: statuses[i], color: tones[i], id: `site-${i + 1}`,
          devices: 4 + Math.round(r() * 30), uptime: statuses[i] === 'Offline' ? 74.2 : statuses[i] === 'Warning' ? 93.5 : round(97 + ((i * 37) % 30) / 10),
        })),
      },
    },
    {
      key: 'sample.zones', label: 'Sample · Service regions (zones)',
      data: {
        shape: 'table', fetchedAt: at(1),
        columns: [
          { key: 'id', label: 'Id', type: 'text' }, { key: 'name', label: 'Region', type: 'text' },
          { key: 'positions', label: 'Outline', type: 'text' }, { key: 'state', label: 'State', type: 'badge' },
        ],
        rows: [
          { id: 'marmara', name: 'Marmara', state: 'success', positions: [[41.4, 27.6], [41.4, 30.2], [39.9, 30.2], [39.9, 27.6]] },
          { id: 'central', name: 'Central Anatolia', state: 'warning', positions: [[40.4, 31.8], [40.4, 33.6], [37.4, 33.6], [37.4, 31.8]] },
        ],
      },
    },
    {
      key: 'sample.routes', label: 'Sample · Delivery routes',
      data: {
        shape: 'table', fetchedAt: at(1),
        columns: [
          { key: 'id', label: 'Id', type: 'text' }, { key: 'name', label: 'Route', type: 'text' }, { key: 'positions', label: 'Path', type: 'text' },
        ],
        rows: [
          { id: 'west', name: 'Istanbul → Bursa → Izmir', positions: [[41.0082, 28.9784], [40.1885, 29.061], [38.4237, 27.1428]] },
          { id: 'south', name: 'Ankara → Konya → Antalya', positions: [[39.9334, 32.8597], [37.8746, 32.4932], [36.8969, 30.7133]] },
        ],
      },
    },
    {
      key: 'sample.events', label: 'Sample · Recent events',
      data: {
        shape: 'table', fetchedAt: at(1),
        columns: [
          { key: 'time', label: 'Time', type: 'date' }, { key: 'title', label: 'Event', type: 'text' },
          { key: 'description', label: 'Where', type: 'text' }, { key: 'color', label: 'Severity', type: 'badge' },
        ],
        rows: [
          { time: at(4), title: 'Temperature above 26 °C', description: 'Sensor D4 · Bursa Line 2', color: 'warning' },
          { time: at(18), title: 'Device went offline', description: 'Sensor F6 · Konya Hub', color: 'error' },
          { time: at(52), title: 'Firmware updated to 2.4.1', description: '12 devices · Istanbul Plant', color: 'info' },
          { time: at(95), title: 'Maintenance finished', description: 'Line 2 · Bursa', color: 'success' },
          { time: at(240), title: 'New site registered', description: 'Kayseri Workshop', color: 'info' },
          { time: at(60 * 26), title: 'Battery low', description: 'Sensor B2 · Ankara Warehouse', color: 'warning' },
        ],
      },
    },
    {
      key: 'sample.channels', label: 'Sample · Orders by channel',
      data: {
        shape: 'table', fetchedAt: at(3),
        columns: [{ key: 'label', label: 'Channel', type: 'text' }, { key: 'value', label: 'Orders', type: 'number' }],
        rows: [{ label: 'Web', value: 512 }, { label: 'Mobile app', value: 389 }, { label: 'Marketplace', value: 214 }, { label: 'Phone', value: 98 }, { label: 'Store', value: 71 }],
      },
    },
    {
      key: 'sample.scatter', label: 'Sample · Load vs. temperature',
      data: {
        shape: 'table', fetchedAt: at(3),
        columns: [{ key: 'x', label: 'Load (%)', type: 'number' }, { key: 'y', label: 'Temperature (°C)', type: 'number' }, { key: 'group', label: 'Line', type: 'text' }],
        rows: Array.from({ length: 60 }, (_, i) => {
          const x = round(20 + r() * 75);
          return { x, y: round(18 + x * 0.12 + (r() - 0.5) * 4), group: i % 2 ? 'Line 2' : 'Line 1' };
        }),
      },
    },
    {
      key: 'sample.response', label: 'Sample · Response times (ms)',
      data: {
        shape: 'table', fetchedAt: at(3),
        columns: [{ key: 'value', label: 'Response (ms)', type: 'number' }],
        rows: Array.from({ length: 300 }, () => ({ value: Math.round(80 + (r() + r() + r()) * 140) })),
      },
    },
    {
      key: 'sample.traffic', label: 'Sample · Visits by weekday and hour',
      data: {
        shape: 'table', fetchedAt: at(3),
        columns: [{ key: 'x', label: 'Hour', type: 'text' }, { key: 'y', label: 'Day', type: 'text' }, { key: 'value', label: 'Visits', type: 'number' }],
        rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].flatMap((day, di) =>
          Array.from({ length: 12 }, (_, hi) => {
            const hour = hi * 2;
            const busy = Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.5 + 0.5;
            return { x: `${String(hour).padStart(2, '0')}:00`, y: day, value: Math.round((di >= 5 ? 40 : 90) * busy + r() * 25) };
          })),
      },
    },
    // ── record
    {
      key: 'sample.device', label: 'Sample · Device details',
      data: {
        shape: 'record', fetchedAt: at(1),
        record: { model: 'Nexus S200', firmware: '2.4.1', serialNumber: 'NX-200-04817', site: 'Istanbul Plant', temperature: lastT, uptimeHours: 1284, battery: 87 },
      },
    },
    ...themedSources(now, at),
    ...plantSources(at),
  ];
}

/**
 * Sensors on the sample process plant (kui-viewer's Coordination demo models, served from
 * /samples/plant/). Coordinates are the IFC model's (metres, Z up), on the equipment they measure.
 */
function plantSources(at: (minAgo: number) => string): SampleSource[] {
  const SENSORS: Array<[string, string, number, number, number, string, number, string, string]> = [
    // id, label, x, y, z, measure, value, unit, status
    ['TT-101', 'C-101 top temperature', -38, 0, 34, 'Temperature', 118.4, '°C', 'Normal'],
    ['PT-102', 'R-102 desalter pressure', -38, -14, 12.3, 'Pressure', 9.8, 'bar', 'Normal'],
    ['TT-103', 'D-103 reflux drum', -21, 0, 21.5, 'Temperature', 46.2, '°C', 'Normal'],
    ['TT-105', 'E-105B outlet', -18, -10.2, 7.1, 'Temperature', 212.7, '°C', 'Warning'],
    ['FT-113', 'P-113A discharge flow', -15, -7.5, 1.4, 'Flow', 3.1, 'm³/h', 'Alarm'],
    ['TT-106', 'A-106 air cooler outlet', 60, 0, 14.6, 'Temperature', 54.9, '°C', 'Normal'],
    ['PT-401', 'V-401 LPG bullet', 27, -22, 4.6, 'Pressure', 14.6, 'bar', 'Warning'],
    ['FT-202', 'TK-202 fill flow', 138, 0, 15.6, 'Flow', 186, 'm³/h', 'Normal'],
    ['FT-301', 'F-301 flare flow', -62, 30, 60, 'Flow', 0.8, 't/h', 'Normal'],
  ];
  return [{
    key: 'sample.plant.sensors', label: 'Sample · Plant sensors (3D)',
    data: {
      shape: 'table', fetchedAt: at(0),
      columns: [
        { key: 'id', label: 'Tag', type: 'text' }, { key: 'label', label: 'Sensor', type: 'text' },
        { key: 'x', label: 'X (m)', type: 'number' }, { key: 'y', label: 'Y (m)', type: 'number' }, { key: 'z', label: 'Z (m)', type: 'number' },
        { key: 'measure', label: 'Measures', type: 'text' }, { key: 'value', label: 'Reading', type: 'number' },
        { key: 'unit', label: 'Unit', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
        { key: 'updatedAt', label: 'Updated', type: 'date' },
      ],
      rows: SENSORS.map(([id, label, x, y, z, measure, value, unit, status], i) => ({
        id, label, x, y, z, measure, value, unit, status, updatedAt: at(i % 3),
      })),
    },
  }];
}

/**
 * The sources the themed sample boards add (energy, sales, infrastructure). A generator of their own,
 * so the sources above keep their exact values.
 */
function themedSources(now: number, at: (minAgo: number) => string): SampleSource[] {
  const r = rng(77);
  const hourOf = (t: string) => new Date(t).getHours() + new Date(t).getMinutes() / 60;
  const solar = walk(11, now, 48, 15, 0, 6, 0).map((p) => {
    const h = hourOf(p.t);
    const sun = Math.max(0, Math.sin(((h - 6) / 14) * Math.PI));
    return { t: p.t, v: Math.round(sun * 180 + (sun > 0 ? Math.abs(p.v) : 0)) };
  });
  const grid = walk(12, now, 48, 15, 210, 30, 0).map((p, i) => ({ t: p.t, v: Math.max(40, p.v - Math.round(solar[i].v * 0.6)) }));
  const requests = walk(13, now, 48, 15, 840, 120, 0);
  const errors = walk(14, now, 48, 15, 6, 3, 0).map((p) => ({ ...p, v: Math.max(0, p.v) }));
  const visitors = walk(15, now, 14, 24 * 60, 16500, 1800, 0);
  const memory = walk(16, now, 48, 15, 70, 4, 0).map((p) => ({ ...p, v: Math.min(96, Math.max(40, p.v)) }));
  const PRODUCTS = [
    ['Smart thermostat', 'Climate'], ['Door sensor', 'Security'], ['Air quality monitor', 'Climate'], ['Smart plug', 'Energy'],
    ['Water leak sensor', 'Security'], ['Energy meter', 'Energy'], ['Motion sensor', 'Security'], ['Gateway Pro', 'Networking'],
  ];
  const SERVICES = [
    ['api-gateway', 'Healthy', 'eu-central'], ['auth', 'Healthy', 'eu-central'], ['telemetry-ingest', 'Degraded', 'eu-west'],
    ['rules-engine', 'Healthy', 'eu-west'], ['notifications', 'Healthy', 'eu-central'], ['reports', 'Down', 'eu-west'], ['billing', 'Healthy', 'eu-central'],
  ];
  return [
    { key: 'sample.energy.today', label: 'Sample · Energy used today (kWh)', data: { shape: 'scalar', value: 4820, fetchedAt: at(2) } },
    { key: 'sample.energy.yesterday', label: 'Sample · Energy used yesterday (kWh)', data: { shape: 'scalar', value: 5110, fetchedAt: at(2) } },
    { key: 'sample.co2', label: 'Sample · CO₂ today (t)', data: { shape: 'scalar', value: 1.92, fetchedAt: at(2) } },
    { key: 'sample.storage', label: 'Sample · Battery storage (%)', data: { shape: 'scalar', value: 68, fetchedAt: at(0) } },
    { key: 'sample.visitors', label: 'Sample · Visitors today', data: { shape: 'scalar', value: 18420, fetchedAt: at(1) } },
    { key: 'sample.visitors.yesterday', label: 'Sample · Visitors yesterday', data: { shape: 'scalar', value: 16950, fetchedAt: at(1) } },
    { key: 'sample.conversion', label: 'Sample · Conversion rate (%)', data: { shape: 'scalar', value: 3.4, fetchedAt: at(1) } },
    { key: 'sample.conversion.yesterday', label: 'Sample · Conversion rate yesterday (%)', data: { shape: 'scalar', value: 3.7, fetchedAt: at(1) } },
    { key: 'sample.aov', label: 'Sample · Average order value', data: { shape: 'scalar', value: 57.8, fetchedAt: at(1) } },
    { key: 'sample.uptime', label: 'Sample · Uptime this month (%)', data: { shape: 'scalar', value: 99.94, fetchedAt: at(0) } },
    { key: 'sample.errors', label: 'Sample · Errors in the last hour', data: { shape: 'scalar', value: 14, fetchedAt: at(0) } },
    { key: 'sample.errors.before', label: 'Sample · Errors in the hour before', data: { shape: 'scalar', value: 21, fetchedAt: at(0) } },
    { key: 'sample.memory', label: 'Sample · Memory used (%)', data: { shape: 'scalar', value: memory[memory.length - 1].v, fetchedAt: at(0) } },
    { key: 'sample.incident', label: 'Sample · Platform status', data: { shape: 'scalar', value: 'DEGRADED', fetchedAt: at(0) } },
    { key: 'sample.solar', label: 'Sample · Solar and grid power (kW, 12 h)', data: { shape: 'series', series: [{ name: 'Solar', points: solar }, { name: 'Grid', points: grid }], fetchedAt: at(0) } },
    { key: 'sample.requests', label: 'Sample · Requests and errors (12 h)', data: { shape: 'series', series: [{ name: 'Requests', points: requests }, { name: 'Errors', points: errors }], fetchedAt: at(0) } },
    { key: 'sample.visitors.series', label: 'Sample · Visitors (14 d)', data: { shape: 'series', series: [{ name: 'Visitors', points: visitors }], fetchedAt: at(1) } },
    { key: 'sample.memory.series', label: 'Sample · Memory used (%, 12 h)', data: { shape: 'series', series: [{ name: 'Memory', points: memory }], fetchedAt: at(0) } },
    {
      key: 'sample.products', label: 'Sample · Best-selling products',
      data: {
        shape: 'table', fetchedAt: at(3),
        columns: [
          { key: 'product', label: 'Product', type: 'text' }, { key: 'category', label: 'Category', type: 'text' },
          { key: 'sold', label: 'Sold', type: 'number' }, { key: 'revenue', label: 'Revenue', type: 'number' }, { key: 'stock', label: 'Stock', type: 'number' },
        ],
        rows: PRODUCTS.map(([product, category], i) => {
          const sold = Math.round(420 - i * 42 + r() * 30);
          return { id: `p-${i + 1}`, product, category, sold, revenue: Math.round(sold * (25 + r() * 60)), stock: Math.round(r() * 100) };
        }),
      },
    },
    {
      key: 'sample.regions', label: 'Sample · Revenue by region',
      data: {
        shape: 'table', fetchedAt: at(3),
        columns: [{ key: 'label', label: 'Region', type: 'text' }, { key: 'value', label: 'Revenue', type: 'number' }],
        rows: [{ label: 'Marmara', value: 148200 }, { label: 'Central Anatolia', value: 86400 }, { label: 'Aegean', value: 71900 }, { label: 'Mediterranean', value: 52300 }, { label: 'Black Sea', value: 24800 }],
      },
    },
    {
      key: 'sample.energy.split', label: 'Sample · Energy by consumer',
      data: {
        shape: 'table', fetchedAt: at(2),
        columns: [{ key: 'label', label: 'Consumer', type: 'text' }, { key: 'value', label: 'kWh', type: 'number' }],
        rows: [{ label: 'Production lines', value: 2310 }, { label: 'HVAC', value: 1120 }, { label: 'Compressors', value: 640 }, { label: 'Lighting', value: 410 }, { label: 'Offices', value: 340 }],
      },
    },
    {
      key: 'sample.services', label: 'Sample · Services',
      data: {
        shape: 'table', fetchedAt: at(0),
        columns: [
          { key: 'service', label: 'Service', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'region', label: 'Region', type: 'text' },
          { key: 'latency', label: 'p95 (ms)', type: 'number' }, { key: 'errorRate', label: 'Errors (%)', type: 'number' }, { key: 'deployedAt', label: 'Deployed', type: 'date' },
        ],
        rows: SERVICES.map(([service, status, region], i) => ({
          id: `svc-${i + 1}`, service, status, region,
          latency: status === 'Down' ? 0 : Math.round((status === 'Degraded' ? 640 : 90) + r() * 160),
          errorRate: status === 'Down' ? 100 : round(status === 'Degraded' ? 4 + r() * 3 : r() * 0.8, 2),
          deployedAt: at(Math.round(60 + r() * 60 * 24 * 6)),
        })),
      },
    },
    // ── process diagrams (readings per symbol id, and a record for the form)
    ...scadaSources(now),
  ];
}

export const sampleData = (key: unknown, now?: number): SlotData | undefined =>
  sampleSources(now).find((s) => s.key === key)?.data;

const P = (id: string, type: string, title: string, x: number, y: number, w: number, h: number, binding: Record<string, string>, settings: Record<string, unknown> = {}): BoardPlacement =>
  ({ id, type, title, x, y, w, h, settings, binding });

/** A board with every builtin widget type, each bound to sample data (the widget gallery). */
export const SAMPLE_GALLERY_BOARD: BoardDocument = {
  format: 'widgetkit.board',
  version: 1,
  templates: {},
  board: { title: 'Widget gallery', settings: {} },
  placements: [
    P('stat', 'stat.value', 'Orders today', 0, 0, 3, 3, { value: 'sample.orders', compare: 'sample.orders.yesterday' },
      { label: 'All channels', icon: 'fas fa-cart-shopping', increaseIs: 'good', compareLabel: 'vs. yesterday' }),
    P('spark', 'stat.sparkline', 'Temperature', 3, 0, 3, 3, { series: 'sample.temperature.series' }, { $format: { unit: '°C', decimals: 1 } }),
    P('progress', 'progress', 'Sales target', 6, 0, 3, 3, { value: 'sample.goal.done', target: 'sample.goal.target' }, { $format: { unit: '₺', unitPosition: 'before', notation: 'compact' } }),
    P('state', 'state', 'Line status', 9, 0, 3, 3, { value: 'sample.state' },
      { states: [{ match: 'RUNNING', label: 'Running', color: 'var(--success)', icon: 'fas fa-circle-check' }, { match: 'STOPPED', label: 'Stopped', color: 'var(--error)' }] }),
    P('line', 'chart.line', 'Climate', 0, 3, 6, 7, { series: 'sample.climate' }, {
      series: [{ key: 'Temperature', unit: '°C', decimals: 1 }, { key: 'Humidity', unit: '%', decimals: 0, axis: 'right', lineStyle: 'dashed' }],
      thresholds: [{ value: 24, label: 'Too warm', color: 'var(--error)', style: 'dashed', width: 1 }],
    }),
    P('area', 'chart.area', 'Power draw', 6, 3, 6, 7, { series: 'sample.power' }, { $format: { unit: 'kW' }, legendValues: ['latest', 'max'] }),
    P('bar', 'chart.bar', 'Daily revenue', 0, 10, 6, 7, { series: 'sample.revenue' }, {
      $format: { unit: '₺', unitPosition: 'before', notation: 'compact' },
      thresholds: [{ value: 15000, label: 'Target', color: 'var(--success)', style: 'dashed', width: 1.5 }],
    }),
    P('gauge', 'gauge', 'CPU load', 6, 10, 3, 7, { value: 'sample.cpu' },
      { $format: { unit: '%' }, ranges: [{ to: 60, color: 'var(--success)' }, { from: 60, to: 85, color: 'var(--warning)' }, { from: 85, color: 'var(--error)' }] }),
    P('pie', 'chart.pie', 'Orders by channel', 9, 10, 3, 7, { slices: 'sample.channels' }, { layout: 'donut-total', totalLabel: 'Orders' }),
    P('table', 'data.table', 'Devices', 0, 17, 8, 8, { rows: 'sample.devices' }, {
      $format: { decimals: 1 },
      columns: [
        { key: 'name' },
        { key: 'site', visible: 'desktop' },
        { key: 'status', cell: 'badge', valueMap: [{ value: 'Online', color: 'var(--success)' }, { value: 'Warning', color: 'var(--warning)' }, { value: 'Offline', color: 'var(--error)' }] },
        { key: 'temperature', label: 'Temp', unit: '°C' },
        { key: 'battery', label: 'Battery', cell: 'progress', decimals: 0, ranges: [{ to: 25, color: 'var(--error)' }, { from: 25, to: 50, color: 'var(--warning)' }, { from: 50, color: 'var(--success)' }] },
        { key: 'lastSeen', align: 'end' },
      ],
    }),
    P('feed', 'data.feed', 'Recent events', 8, 17, 4, 8, { events: 'sample.events' }),
    P('map', 'map', 'Sites', 0, 25, 6, 8, { points: 'sample.sites' }, { tooltipColumns: ['devices', 'uptime'] }),
    P('heatmap', 'heatmap', 'Visits by weekday and hour', 6, 25, 6, 8, { cells: 'sample.traffic' }, { valueName: 'Visits' }),
    P('scatter', 'chart.scatter', 'Load vs. temperature', 0, 33, 6, 7, { points: 'sample.scatter' }, {
      groupColumn: 'group', xUnit: '%', yUnit: '°C', trendLine: true,
    }),
    P('histogram', 'chart.histogram', 'Response times', 6, 33, 6, 7, { values: 'sample.response' }, { $format: { unit: 'ms' }, showMean: true, showMedian: true }),
    P('attributes', 'stat.attributes', 'Device details', 0, 40, 4, 6, { record: 'sample.device' },
      { fields: [{ key: 'model' }, { key: 'firmware' }, { key: 'site' }, { key: 'temperature', unit: '°C', ranges: [{ from: 26, color: 'var(--error)' }] }, { key: 'uptimeHours', label: 'Uptime', unit: 'h' }, { key: 'battery', unit: '%', ranges: [{ to: 20, color: 'var(--error)' }] }] }),
    P('markdown', 'content.markdown', 'About this board', 4, 40, 4, 6, { record: 'sample.device' },
      { content: '### Line 2 overview\n\nThe **{{model}}** at *{{site}}* runs firmware **v{{firmware}}** and has been up for **{{uptimeHours}} h**.\n\n- Check the coolant level every shift\n- Report alarms to the line lead\n\n[Open the device list](/devices)' }),
    P('links', 'content.links', 'Shortcuts', 8, 40, 4, 6, {},
      { links: [{ label: 'Devices', href: '/devices', description: 'Every registered device', icon: 'fas fa-microchip' }, { label: 'Alerts', href: '/alerts', description: 'Open alerts', icon: 'fas fa-bell' }, { label: 'Documentation', href: 'https://example.com/docs', description: 'How the platform works', icon: 'fas fa-book' }] }),
    P('image', 'content.image', 'Plant floor', 0, 46, 4, 6, {},
      { src: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1200', alt: 'A factory floor with machines', caption: 'Bursa Line 2' }),
    P('embed', 'content.embed', 'Status page', 4, 46, 4, 6, {}, { url: 'https://www.openstreetmap.org/export/embed.html?bbox=28.9,40.95,29.1,41.05&layer=mapnik' }),
    P('button', 'control.button', 'Restart line', 8, 46, 4, 3, {}, { label: 'Restart', icon: 'fas fa-rotate-right', description: 'Restarts conveyor 2 after a stop' }),
    P('switch', 'control.switch', 'Coolant pump', 8, 49, 4, 3, { value: 'sample.pump' }, { label: 'Pump power', icon: 'fas fa-droplet' }),
    P('slider', 'control.slider', 'Fan speed', 0, 52, 6, 3, { value: 'sample.cpu' }, { $format: { unit: '%' }, label: 'Speed', startIcon: 'fas fa-fan', tickMarks: 5 }),
    P('setpoint', 'control.setpoint', 'Thermostat', 6, 52, 6, 3, { value: 'sample.setpoint' }, { $format: { unit: '°C', decimals: 1 }, label: 'Target temperature', layout: 'stepper', min: 10, max: 30, step: 0.5 }),
    P('viewer', 'viewer.model', 'Process plant (3D)', 0, 55, 12, 10, { sensors: 'sample.plant.sensors' }, PLANT_MODEL),
    // A CC0 clip from MDN's examples (the same kind of public sample as the image above).
    P('video', 'content.video', 'Line camera', 0, 65, 6, 6, {},
      { src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' }),
    P('symbol', 'scada.symbol', 'Storage tank', 0, 71, 3, 6, { value: 'sample.cpu', running: 'sample.pump' },
      { symbol: 'tank.vertical', label: 'Tank 1', $format: { unit: '%', decimals: 0 } }),
    P('form', 'control.form', 'Drilling parameters', 3, 71, 4, 8, { record: 'sample.scada.rig.params' }, { label: 'Set and save together' }),
    P('scene', 'scada.scene', 'Pool plant', 0, 79, 12, 12, { points: 'sample.scada.pool' }, POOL_SCENE.settings),
  ],
};
