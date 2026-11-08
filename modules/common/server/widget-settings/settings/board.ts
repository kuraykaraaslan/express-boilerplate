// Vendored from kui-react f7db139: modules/app/WidgetKit/settings/board.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The board document: a dashboard with every card on it, as one portable JSON (D-21.4).
// Pure; used for export/import in kui-react's IoT theme. next-boilerplate's board package v2
// carries the same parts (board settings + every placement's stamped settings) plus data bindings.

import { CORE_BOARD, CORE_CARD, CORE_FORMAT } from './core';
import { prepareForSave, readStamp } from './engine';
import type { Issue, SettingsStamp, SettingsTemplate, Sparse } from './types';
import type { BuiltinKindSpec } from '../kind';
import { DEFAULT_GRID_COLS, normalizeGridCols, resolveOverlaps, scaleWidth, type GridCols } from './grid';

export const BOARD_DOCUMENT_FORMAT = 'widgetkit.board';
/**
 * The newest document version this code reads and writes. Version 2 adds `board.gridCols`; a board
 * on the default 12 columns still exports as version 1, so older readers keep importing it.
 */
export const BOARD_DOCUMENT_VERSION = 2;
/** The default column count (a board's own is `board.gridCols`, see `settings/grid.ts`). */
export const GRID_COLUMNS = DEFAULT_GRID_COLS;

export interface BoardPlacement {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: Sparse;
  /** Host-specific data binding (opaque to WidgetKit; carried as is). */
  binding?: unknown;
}

export interface BoardDocument {
  format: typeof BOARD_DOCUMENT_FORMAT;
  version: number;
  /** The newest version of each template used inside (lets an importer refuse what it cannot read). */
  templates: SettingsStamp;
  board: {
    title: string;
    description?: string;
    /** The board's column count (version 2); absent = 12. */
    gridCols?: GridCols;
    settings: Sparse;
  };
  placements: BoardPlacement[];
}

const isObj = (v: unknown): v is Sparse => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, min: number, max: number, dflt: number) =>
  Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : dflt;

/** Validate, migrate and stamp every part; the result is ready to download. */
export function exportBoard(doc: BoardDocument, kinds: readonly BuiltinKindSpec[]): BoardDocument {
  const res = normalizeBoard(doc, kinds);
  return res.doc;
}

export interface ImportResult {
  doc: BoardDocument;
  issues: Issue[];
  /** Templates in the file that are newer than this code: the import must stop. */
  newer: Array<{ id: string; stored: number; known: number }>;
  /** Placement types this host does not know: dropped. */
  unknownTypes: string[];
}

/** Why `importBoard` refused a file: `error` is the English text, `code` + `detail` let a host word it. */
export interface ImportRefusal {
  error: string;
  code: 'invalid-json' | 'not-board' | 'newer-format' | 'newer-templates';
  /** `newer-format`: the file's format version; `newer-templates`: the newer templates, joined ("core:card v9"). */
  detail?: string;
}

function normalizeBoard(input: unknown, kinds: readonly BuiltinKindSpec[], defaultTitle = 'Dashboard'): ImportResult {
  const issues: Issue[] = [];
  const newer: ImportResult['newer'] = [];
  const unknownTypes: string[] = [];
  const src = isObj(input) ? input : {};
  const boardSrc = isObj(src.board) ? src.board : {};
  const stamp: SettingsStamp = {};
  const note = (t: SettingsTemplate) => { stamp[t.id] = t.version; };

  const boardSave = prepareForSave(isObj(boardSrc.settings) ? boardSrc.settings : {}, { type: CORE_BOARD });
  newer.push(...boardSave.newer);
  issues.push(...boardSave.issues.map((i) => ({ ...i, path: `board.settings.${i.path}` })));
  note(CORE_BOARD);

  const cols = normalizeGridCols(boardSrc.gridCols);
  let clamped = false;
  const placements: BoardPlacement[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(src.placements) ? src.placements : [];
  list.slice(0, 200).forEach((raw, i) => {
    if (!isObj(raw)) return;
    const kind = kinds.find((k) => k.type === raw.type);
    if (!kind) { unknownTypes.push(String(raw.type)); return; }
    const set = { type: kind.template, card: CORE_CARD, format: kind.template.format ? CORE_FORMAT : undefined };
    const saved = prepareForSave(isObj(raw.settings) ? raw.settings : {}, set);
    newer.push(...saved.newer);
    issues.push(...saved.issues.map((x) => ({ ...x, path: `placements.${i}.${x.path}` })));
    note(kind.template); note(CORE_CARD); if (set.format) note(CORE_FORMAT);
    let id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : `w${i + 1}`;
    while (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    // A type's `defaultW` is "of 12": scale it to this board's columns, as the WidgetBoard picker does.
    const w = int(raw.w, 1, cols, scaleWidth(kind.defaultW, DEFAULT_GRID_COLS, cols));
    const x = int(raw.x, 0, cols - w, 0);
    if (w !== raw.w || x !== raw.x) clamped = true;
    placements.push({
      id,
      type: kind.type,
      title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : kind.label,
      x,
      y: int(raw.y, 0, 10000, 0),
      w,
      h: int(raw.h, 1, 48, kind.defaultH),
      settings: saved.newer.length ? (raw.settings as Sparse) : saved.settings,
      ...(raw.binding !== undefined ? { binding: raw.binding } : {}),
    });
  });

  // Cards clamped into the grid one by one may land on the same cells: push those down. A layout
  // that needed no clamping is kept as it is (an editor may hold overlaps on purpose while moving).
  const laidOut = clamped ? resolveOverlaps(placements) : placements;

  const fileStamp = readStamp({ $v: src.templates });
  for (const [id, v] of Object.entries(fileStamp)) {
    const known = id === CORE_BOARD.id ? CORE_BOARD.version : id === CORE_CARD.id ? CORE_CARD.version : id === CORE_FORMAT.id ? CORE_FORMAT.version
      : kinds.find((k) => k.template.id === id)?.template.version;
    if (known !== undefined && (v as number) > known && !newer.some((n) => n.id === id)) newer.push({ id, stored: v as number, known });
  }

  return {
    doc: {
      format: BOARD_DOCUMENT_FORMAT,
      // Version 2 only when the document needs it (24 columns).
      version: cols === DEFAULT_GRID_COLS ? 1 : 2,
      templates: stamp,
      board: {
        title: typeof boardSrc.title === 'string' && boardSrc.title.trim() ? boardSrc.title.slice(0, 120) : defaultTitle,
        ...(typeof boardSrc.description === 'string' ? { description: boardSrc.description.slice(0, 1000) } : {}),
        ...(cols !== DEFAULT_GRID_COLS ? { gridCols: cols } : {}),
        settings: boardSave.newer.length ? (boardSrc.settings as Sparse) : boardSave.settings,
      },
      placements: laidOut,
    },
    issues,
    newer,
    unknownTypes,
  };
}

/**
 * Read an uploaded board file. A newer document format is refused with a clear message (`error`, in
 * English) and a `code` the host can word itself. `options.defaultTitle` names a board without a title.
 */
export function importBoard(
  json: string,
  kinds: readonly BuiltinKindSpec[],
  options: { defaultTitle?: string } = {},
): ImportResult | ImportRefusal {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { error: 'This file is not valid JSON.', code: 'invalid-json' }; }
  if (!isObj(parsed) || parsed.format !== BOARD_DOCUMENT_FORMAT) return { error: 'This file is not a dashboard export.', code: 'not-board' };
  if (typeof parsed.version !== 'number' || parsed.version > BOARD_DOCUMENT_VERSION) {
    const detail = String(parsed.version);
    return { error: `This dashboard was exported by a newer version (format ${detail}). Update this app to import it.`, code: 'newer-format', detail };
  }
  const res = normalizeBoard(parsed, kinds, options.defaultTitle?.trim() || undefined);
  if (res.newer.length) {
    const detail = res.newer.map((n) => `${n.id} v${n.stored}`).join(', ');
    return { error: `This dashboard uses newer widget settings (${detail}). Update this app to import it.`, code: 'newer-templates', detail };
  }
  return res;
}

/** The first free row below every placement (where a new card goes). */
export function nextFreeRow(placements: BoardPlacement[]): number {
  return placements.reduce((m, p) => Math.max(m, p.y + p.h), 0);
}
