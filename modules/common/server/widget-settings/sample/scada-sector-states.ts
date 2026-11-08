// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-states.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// "Symbol states": the states layer on a grid. One column per state, one row per symbol, every cell the same drawing in a
// different condition, with a note on what each column means (pure data).

import type { BoardDocument } from '../settings/board';
import { board, P, scene } from './scada-board-kit';
import type { ScadaScene } from './scada-scenes';

type Elem = Record<string, unknown>;
type Row = Record<string, unknown>;

// A cell's id is `<symbol row>_<state column>` (`pump_half_speed`): the readable key grammar of dashboard phase 45.1; its label names both (data only).
const COLUMNS: Array<{ key: string; title: string; row: Row }> = [
  { key: 'running', title: 'Running', row: { running: true, value: 62 } },
  { key: 'manual', title: 'Manual', row: { running: true, value: 62, mode: 'manual' } },
  { key: 'maintenance', title: 'Maintenance', row: { running: true, value: 62, mode: 'maintenance' } },
  { key: 'lockout', title: 'Locked out', row: { value: 62, mode: 'lockout' } },
  { key: 'stale', title: 'Stale data', row: { running: true, value: 62, quality: 'stale' } },
  { key: 'bad_data', title: 'Bad data', row: { running: true, value: 62, quality: 'bad' } },
  { key: 'offline', title: 'Lost', row: { value: 62, quality: 'offline' } },
  { key: 'alarm', title: 'Alarm, new', row: { running: true, value: 62, status: 'critical', ack: false } },
  { key: 'pending', title: 'Command sent', row: { running: true, value: 62, pending: true, position: 40 } },
  { key: 'failed', title: 'Command failed', row: { running: true, value: 62, failed: true, mode: 'local' } },
  { key: 'half_speed', title: 'Half speed', row: { running: true, value: 62, speed: 50 } },
  { key: 'reversed', title: 'Reversed', row: { running: true, value: 62, direction: 'reverse' } },
];
const ROWS: Array<{ key: string; title: string; symbol: string; scale: number }> = [
  { key: 'tank', title: 'Tank', symbol: 'tank.vertical', scale: 0.85 },
  { key: 'valve', title: 'Valve', symbol: 'valve.ball', scale: 0.85 },
  { key: 'fan', title: 'Fan', symbol: 'process.fan', scale: 0.85 },
  { key: 'pump', title: 'Pump', symbol: 'pump.motor', scale: 0.55 },
  { key: 'breaker', title: 'Breaker', symbol: 'breaker', scale: 0.85 },
];

const X0 = 190; const DX = 150; const Y0 = 175; const DY = 150;
const elements: Elem[] = [];
const rows: Row[] = [];
for (const [j, r] of ROWS.entries()) for (const [i, c] of COLUMNS.entries()) {
  const id = `${r.key}_${c.key}`;
  elements.push({ id, symbol: r.symbol, x: X0 + i * DX, y: Y0 + j * DY, scale: r.scale, label: `${r.title} · ${c.title}`, labelPos: 'n', showValue: false });
  rows.push({ id, ...c.row });
}
const shapes: Elem[] = [
  { kind: 'text', x: 24, y: 40, text: 'Symbol states', size: 'l', align: 'start' },
  ...COLUMNS.map((c, i) => ({ kind: 'text', x: X0 + i * DX, y: 82, text: c.title, size: 's', align: 'middle' })),
  ...ROWS.map((r, j) => ({ kind: 'divider', x: 24, y: Y0 + j * DY - 75, w: X0 + (COLUMNS.length - 1) * DX + 90, h: 0 })),
];

export const SECTOR_SCENE: ScadaScene = {
  source: 'sample.scada.states',
  title: 'Symbol states',
  settings: { width: X0 + COLUMNS.length * DX, height: Y0 + ROWS.length * DY, scale: 1, background: 'dots', fit: 'content', showLabels: true, shapes, elements, links: [] },
  rows,
};

export const SECTOR_BOARD: BoardDocument = board('SCADA · Symbol states', [
  scene(SECTOR_SCENE, 12, 8),
  P('legend', 'content.markdown', 'What the badges mean', 0, 8, 6, 6, {}, {
    content: '### Badges\n\n- **M, L, S**: manual, local and simulated operation\n- **Wrench**: in maintenance\n- **Padlock**: locked out, no action runs from the symbol\n- **Clock, ?, cross**: stale, bad or lost data, with a dashed frame\n- **Bell and pulsing frame**: an alarm nobody has acknowledged yet\n- **Spinner and !**: a command in flight, or one that failed\n- **Bar along the bottom**: how far open a valve or door is',
  }),
  P('columns', 'content.markdown', 'Where the states come from', 6, 8, 6, 6, {}, {
    content: '### Columns of the readings table\n\n`mode`, `quality`, `speed` (percent of nominal, 0 = stalled, negative = reversed), `direction`, `ack`, `position`, `pending`, `failed`.\n\nA rule can set any of them too, so a symbol can switch to manual when a parameter says so, or slow down when the load drops.',
  }),
]);
