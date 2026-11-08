// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-board-kit.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The small builders every SCADA sample board is written with (pure): a placement, a board and the placement of a scene.
// The five original boards keep their own copies in `scada-boards.ts`; the sector boards import these.

import type { BoardDocument, BoardPlacement } from '../settings/board';
import type { ScadaScene } from './scada-scenes';

export const P = (id: string, type: string, title: string, x: number, y: number, w: number, h: number, binding: Record<string, string>, settings: Record<string, unknown> = {}): BoardPlacement =>
  ({ id, type, title, x, y, w, h, settings, binding });

export const board = (title: string, placements: BoardPlacement[]): BoardDocument =>
  ({ format: 'widgetkit.board', version: 1, templates: {}, board: { title, settings: {} }, placements });

export const OK = 'var(--success)';
export const BAD = 'var(--error)';
export const WARN = 'var(--warning)';

/** The diagram placement: `w` x `h` cells at the board's origin, bound to the scene's readings. */
export const scene = (s: ScadaScene, w: number, h: number): BoardPlacement => P('scene', 'scada.scene', s.title, 0, 0, w, h, { points: s.source }, s.settings);

export const RUNNING_STATES = (label: string) => ({
  label,
  states: [{ match: 'RUNNING', label: 'Running', color: OK, icon: 'fas fa-circle-check', pulse: true }, { match: 'STOPPED', label: 'Stopped', color: BAD, icon: 'fas fa-circle-xmark' }, { match: 'IDLE', label: 'Idle', color: WARN, icon: 'fas fa-pause' }],
});
