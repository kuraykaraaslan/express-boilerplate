// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-logic.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The pure logic of the process symbol widget (no React): which symbol, in which state, filled how far, and the drawing
// itself as an SVG node tree (`svg-node.ts`). The widget never evaluates a threshold: the source says `warning` or
// `critical` and the symbol only shows it. `ScadaSymbolView.tsx` draws the nodes.
//
// The symbol library is a registry (docs/phases/07-dashboard/31-scada-pieces.md, contract C2):
// - What every symbol IS (key, family, name, flags, renames, search words, box) is the static manifest `scada-manifest.ts`,
//   generated from the drawings. Whatever reads only that (the templates, select validation, search, the server) never
//   loads a drawing; `SCADA_SYMBOL_DEFS` here is that metadata.
// - How a symbol is DRAWN: the base symbols below (drawn in `scada-water.ts`, `scada-energy.ts`, `scada-line.ts`,
//   `scada-instruments.ts`, `scada-oil.ts`, `scada-network.ts` on the shared rules of `scada-draw.ts`) are registered
//   here. The sector packs belong to the IoT module `dashboard_scada`; each pack file is registered at run time by the
//   loader the host installs under `scada-pack-<id>` (`kit-runtime.ts`), the first time one of its symbols is drawn.
// - A symbol whose pack has not arrived, or a key the library does not have, draws a neutral placeholder in the symbol's
//   box. `subscribeScadaRegistry` tells the views to draw again when a pack arrives.

import type { SlotData } from '../kind';
import { kitLoader, subscribeKitRuntime } from '../kit-runtime';
import { cssColor } from '../settings/style';
import { rangesToBands } from './gauge-logic';
import { harmonize, MUTED, type Drawn, type Paint, type ScadaState } from './scada-draw';
import {
  batteryBank, breaker, building, generator, inverter, meterEnergy, solarPanel,
  transformer, windTurbine, wireCross, wireElbow, wireStraight, wireTee,
} from './scada-energy';
import {
  brushUnit, cableElbow, cableMulti, cableStraight, cableTee, coater, hoseElbow, hoseSag, hoseStraight, joiner, loopTower, oven, quench, reel, roller, rollerNip, shear, steering, stripElbow, stripStraight,
} from './scada-line';
import {
  drain, filterSand, heatPump, meterDial, meterFlow, pipeCross, pipeElbow, pipeStraight, pipeTee, pumpMotor, strainer, tank, tankOpen,
  valveBall, valveGate, valveSolenoid, valveWheel,
} from './scada-water';
import { compass, indicatorBattery, indicatorSignal } from './scada-instruments';
import { bop, degasser, drawworks, drillBit, meterDepth, pumpVolute, rigDerrick, tankScale } from './scada-oil';
import {
  basinClarifier, chlorinator, hydrant, reservoirGround, rtu, sensorLevel, sensorPressure, stationPump, towerWater, valveButterfly, valveCheck, valvePrv, wellBore,
} from './scada-network';
import { SCADA_MANIFEST, SCADA_MANIFEST_RENAMES, SCADA_SYMBOL_KEYS, type ScadaManifestEntry, type ScadaSymbolKey } from './scada-manifest';
import { applyStates, readStates } from './scada-states';
import { el, orient, r2, type Orientation, type SvgNode } from './svg-node';

export type { ScadaState } from './scada-draw';

export type ScadaFamily =
  | 'water' | 'network' | 'oil' | 'energy' | 'connection' | 'line' | 'instrument'
  | 'watergas' | 'access' | 'pharma' | 'paper' | 'steel' | 'storage' | 'gasnet' | 'hydro' | 'building' | 'logistics'
  | 'kitchen' | 'gadget' | 'fluid' | 'mech' | 'safety' | 'home' | 'appliance'
  | 'process' | 'isa' | 'hvac' | 'sld' | 'telecom' | 'food' | 'agri' | 'wastewater' | 'factory' | 'mining' | 'city' | 'mes' | 'textile' | 'plastic' | 'metal' | 'cement' | 'wood';

/**
 * The roles of a tracking point (docs/reference/scada-standards.md TP-1, material-tracking 01 §1.3): what the platform learns where a tracked
 * unit passes it. `factory.encoder` is a pace source, never a point.
 */
export const SCADA_TRACK_ROLES = ['entry', 'detect', 'identify', 'measure', 'inspect', 'test', 'mark', 'divert', 'reject', 'exit', 'zone', 'transfer'] as const;
export type ScadaTrackRole = (typeof SCADA_TRACK_ROLES)[number];

/**
 * Where a tracking symbol's point is (docs/reference/scada-standards.md TP-2, docs/phases/07-dashboard/54 S54-E8): the role it suggests by
 * default (the `material_tracking` point record's role is the one that counts, TP-4) and the point in units of the symbol's box at rest, one
 * cell long: on the product line (`y = 50`, `y = 62` for the bottle class) for a symbol a belt runs through, at the middle of its sensing face
 * for one that stands beside a belt. Metadata only: no drawing reads it, the pen is unchanged.
 */
export interface ScadaTrack {
  role: ScadaTrackRole;
  x: number;
  y: number;
}

/** What the manifest says of a symbol: everything but its drawing. */
export interface SymbolMeta {
  family: ScadaFamily;
  /** The symbol's name (English; the picker and the screen-reader text). */
  label: string;
  /** The symbol has a scale: a minimum and a maximum apply to its reading. */
  scaled?: boolean;
  /** The reading is also printed under the drawing (the others draw it inside, or have none). */
  valueUnder?: boolean;
  /** A straight run: its length in cells applies. */
  runs?: boolean;
  /** Draws two readings (`value2`) with row names. */
  rows?: boolean;
  /** A tracking point's default role and place in the box (TP-2); only a tracking symbol has one. */
  track?: ScadaTrack;
}

/** A symbol with its drawing: what a pack file exports (`<PACK>_DEFS`) and the base symbols below are. */
export interface SymbolDef extends SymbolMeta {
  draw: (p: Paint) => Drawn;
}

/** A reading no drawing makes up by itself: what `drawsOwnNumber` asks a symbol to print. */
const PROBE_VALUE = 12345.678;

/** Does a symbol print its reading itself (a dial's or a display's own figure)? Found by drawing it with a reading no drawing invents. */
export function drawsOwnNumber(def: Pick<SymbolDef, 'draw'>): boolean {
  const p = scadaPaint({}, { value: { value: PROBE_VALUE } as SlotData }, { animate: false });
  const shown = p.fmt(PROBE_VALUE);
  const has = (node: unknown): boolean => (typeof node === 'string' ? node.includes(shown)
    : Array.isArray(node) ? node.some(has)
      : !!node && typeof node === 'object' && Object.values(node as Record<string, unknown>).some(has));
  return has(def.draw(p).nodes);
}

/**
 * Whether a symbol prints its reading under the drawing (`valueUnder` in the manifest): one that says so, and every other symbol that does not print
 * it itself, a connection and a straight run aside. Before (e2e run 1, V1-B7), 347 of 558 symbols could never show the number the link panel offered
 * them ("Shows 28.8 now") and hid "Show the number": a pump's current, a well's flow, a blower's kW.
 */
export function printsValueUnder(def: SymbolDef): boolean {
  if (def.valueUnder === true) return true;
  if (def.family === 'connection' || def.runs === true) return false;
  return !drawsOwnNumber(def);
}

/** The base symbols: drawn by this file's imports, always registered (the core of the library, in every edition). */
export const SCADA_BASE_DEFS = {
  'tank.vertical': { family: 'water', label: 'Tank (standing)', draw: (p) => tank(56, 84, p), scaled: true, valueUnder: true },
  'tank.short': { family: 'water', label: 'Tank (short)', draw: (p) => tank(80, 52, p), scaled: true, valueUnder: true },
  'tank.open': { family: 'water', label: 'Open basin', draw: tankOpen, scaled: true, valueUnder: true },
  'pump.motor': { family: 'water', label: 'Motor pump', draw: pumpMotor },
  'filter.sand': { family: 'water', label: 'Sand filter', draw: filterSand },
  'strainer': { family: 'water', label: 'Strainer', draw: strainer },
  'heat.pump': { family: 'water', label: 'Heat pump', draw: heatPump },
  'drain': { family: 'water', label: 'Drain', draw: drain },
  'valve': { family: 'water', label: 'Gate valve', draw: valveGate },
  'valve.ball': { family: 'water', label: 'Actuated valve', draw: valveBall },
  'valve.wheel': { family: 'water', label: 'Wheel valve', draw: valveWheel },
  'valve.solenoid': { family: 'water', label: 'Solenoid valve', draw: valveSolenoid },
  'meter.flow': { family: 'water', label: 'Flow meter', draw: meterFlow },
  'meter.pressure': { family: 'water', label: 'Dial', draw: meterDial, scaled: true, valueUnder: true },
  'tower.water': { family: 'network', label: 'Water tower', draw: towerWater, scaled: true, valueUnder: true },
  'reservoir.ground': { family: 'network', label: 'Ground reservoir', draw: reservoirGround, scaled: true, valueUnder: true },
  'well.bore': { family: 'network', label: 'Borehole', draw: wellBore },
  'station.pump': { family: 'network', label: 'Pump station', draw: stationPump },
  'chlorinator': { family: 'network', label: 'Chlorinator', draw: chlorinator, scaled: true },
  'valve.prv': { family: 'network', label: 'Pressure-reducing valve', draw: valvePrv },
  'valve.check': { family: 'network', label: 'Check valve', draw: valveCheck },
  'valve.butterfly': { family: 'network', label: 'Butterfly valve', draw: valveButterfly },
  'hydrant': { family: 'network', label: 'Hydrant', draw: hydrant },
  'rtu': { family: 'network', label: 'Telemetry cabinet', draw: rtu },
  'sensor.pressure': { family: 'network', label: 'Pressure transmitter', draw: sensorPressure },
  'sensor.level': { family: 'network', label: 'Level gauge', draw: sensorLevel, scaled: true, valueUnder: true },
  'basin.clarifier': { family: 'network', label: 'Clarifier', draw: basinClarifier },
  'rig.derrick': { family: 'oil', label: 'Derrick', draw: rigDerrick, scaled: true },
  'drawworks': { family: 'oil', label: 'Drawworks', draw: drawworks },
  'pump.volute': { family: 'oil', label: 'Mud pump', draw: pumpVolute },
  'bop': { family: 'oil', label: 'Blowout preventer', draw: bop },
  'drill.bit': { family: 'oil', label: 'Drill bit', draw: drillBit },
  'tank.scale': { family: 'oil', label: 'Scaled tank', draw: tankScale, scaled: true, valueUnder: true },
  'degasser': { family: 'oil', label: 'Degasser', draw: degasser },
  'meter.depth': { family: 'oil', label: 'Depth gauge', draw: meterDepth, scaled: true, valueUnder: true },
  'indicator.battery': { family: 'instrument', label: 'Battery indicator', draw: indicatorBattery, scaled: true, valueUnder: true },
  'indicator.signal': { family: 'instrument', label: 'Signal strength', draw: indicatorSignal, scaled: true, valueUnder: true },
  'compass': { family: 'instrument', label: 'Compass', draw: compass, valueUnder: true },
  'pipe.straight': { family: 'connection', label: 'Pipe (straight)', draw: pipeStraight, runs: true },
  'pipe.elbow': { family: 'connection', label: 'Pipe (elbow)', draw: pipeElbow },
  'pipe.tee': { family: 'connection', label: 'Pipe (tee)', draw: pipeTee },
  'pipe.cross': { family: 'connection', label: 'Pipe (cross)', draw: pipeCross },
  'hose.straight': { family: 'connection', label: 'Hose (straight)', draw: hoseStraight, runs: true },
  'hose.elbow': { family: 'connection', label: 'Hose (elbow)', draw: hoseElbow },
  'hose.sag': { family: 'connection', label: 'Hose (sagging)', draw: hoseSag },
  'cable.straight': { family: 'connection', label: 'Cable (straight)', draw: cableStraight, runs: true },
  'cable.multi': { family: 'connection', label: 'Cable (three conductors)', draw: cableMulti, runs: true },
  'cable.elbow': { family: 'connection', label: 'Cable (elbow)', draw: cableElbow },
  'cable.tee': { family: 'connection', label: 'Cable (tee)', draw: cableTee },
  'wire.straight': { family: 'connection', label: 'Signal wire (straight)', draw: wireStraight, runs: true },
  'wire.elbow': { family: 'connection', label: 'Signal wire (elbow)', draw: wireElbow },
  'wire.tee': { family: 'connection', label: 'Signal wire (tee)', draw: wireTee },
  'wire.cross': { family: 'connection', label: 'Signal wire (cross)', draw: wireCross },
  'solar.panel': { family: 'energy', label: 'Solar array', draw: solarPanel },
  'wind.turbine': { family: 'energy', label: 'Wind turbine', draw: windTurbine },
  'battery.bank': { family: 'energy', label: 'Battery bank', draw: batteryBank, scaled: true, valueUnder: true },
  'inverter': { family: 'energy', label: 'Inverter / charger', draw: inverter },
  'breaker': { family: 'energy', label: 'Breaker', draw: breaker },
  'transformer': { family: 'energy', label: 'Transformer', draw: transformer },
  'generator': { family: 'energy', label: 'Generator', draw: generator },
  'building': { family: 'energy', label: 'Consumer (buildings)', draw: building },
  'meter.energy': { family: 'energy', label: 'Two-row meter', draw: meterEnergy, rows: true },
  'reel.payoff': { family: 'line', label: 'Payoff reel', draw: (p) => reel(p, false), scaled: true },
  'reel.rewind': { family: 'line', label: 'Rewind reel', draw: (p) => reel(p, true), scaled: true },
  'roller': { family: 'line', label: 'Roller', draw: roller },
  'roller.nip': { family: 'line', label: 'Nip rolls', draw: rollerNip },
  'loop.tower': { family: 'line', label: 'Loop tower', draw: loopTower, scaled: true },
  'oven': { family: 'line', label: 'Strip oven', draw: oven, scaled: true, valueUnder: true },
  'coater': { family: 'line', label: 'Roll coater', draw: coater },
  'brush.unit': { family: 'line', label: 'Brush unit', draw: brushUnit },
  'shear': { family: 'line', label: 'Shear', draw: shear },
  'joiner': { family: 'line', label: 'Joiner', draw: joiner },
  'quench': { family: 'line', label: 'Quench', draw: quench },
  'steering': { family: 'line', label: 'Steering unit', draw: steering },
  'strip.straight': { family: 'line', label: 'Strip (straight)', draw: stripStraight, runs: true },
  'strip.elbow': { family: 'line', label: 'Strip (elbow)', draw: stripElbow },
} as const satisfies Record<string, SymbolDef>;

/**
 * Every symbol of the library, base and packs, with its metadata (the manifest; no drawing). The picker, select validation,
 * search and the server read this. A pack symbol is here whether or not its pack file has arrived.
 */
export const SCADA_SYMBOL_DEFS: Readonly<Record<ScadaSymbolKey, SymbolMeta>> = SCADA_MANIFEST;
export type ScadaSymbol = ScadaSymbolKey;
/** Every symbol key, in the registry's order (the base symbols, then the packs in their order). */
export const SCADA_SYMBOLS: ScadaSymbol[] = [...SCADA_SYMBOL_KEYS];
export type ScadaStatus = 'none' | 'warning' | 'critical';
export type ScadaMedium = 'none' | 'cold' | 'hot' | 'water' | 'custom';

/**
 * Symbols that were merged into another one (the same equipment drawn twice): the old key keeps drawing as the kept one, so a
 * diagram saved before the merge still opens, and the settings upgrade (template versions) rewrites it. From the manifest.
 */
export const SYMBOL_RENAMES: Readonly<Record<string, string>> = SCADA_MANIFEST_RENAMES;

/** The key a symbol is drawn under: a merged one resolves to the symbol it was merged into. */
export const canonicalSymbol = (v: string): string => SYMBOL_RENAMES[v] ?? v;

export const isScadaSymbol = (v: unknown): v is ScadaSymbol => typeof v === 'string' && Object.hasOwn(SCADA_MANIFEST, canonicalSymbol(v));

/** A symbol's manifest entry (after renames), or undefined for a key the library does not have. */
export const scadaManifestEntry = (v: unknown): ScadaManifestEntry | undefined =>
  (isScadaSymbol(v) ? SCADA_MANIFEST[canonicalSymbol(v) as ScadaSymbol] : undefined);

/** The pack a symbol is drawn by, after renames: a pack id (`scada-pack-<id>.ts`), `base` for this file's own, undefined for a key the library lacks. */
export const scadaPackOf = (v: unknown): string | undefined => scadaManifestEntry(v)?.pack;

/** The symbols that need a minimum and maximum, a run length, two readings. */
export const SCALED_SYMBOLS = SCADA_SYMBOLS.filter((k) => SCADA_SYMBOL_DEFS[k].scaled);
export const RUN_SYMBOLS = SCADA_SYMBOLS.filter((k) => SCADA_SYMBOL_DEFS[k].runs);
export const VALUE_SYMBOLS = SCADA_SYMBOLS.filter((k) => SCADA_SYMBOL_DEFS[k].valueUnder);

// ─── The registry of drawings ────────────────────────────────────────────────

/** The drawings registered so far, by key: the base symbols, then every pack file that arrived. */
const DRAWN = new Map<string, SymbolDef>(Object.entries(SCADA_BASE_DEFS));
/** The pack files whose loader resolved (whatever they held), so a pack is fetched once. */
const LOADED = new Set<string>(['base']);
/** The pack files being fetched. */
const LOADING = new Map<string, Promise<boolean>>();
/** Pack files asked for while no loader served them: fetched as soon as a host installs one. */
const WANTED = new Set<string>();
/**
 * Pack files whose last fetch failed: when, and how long to wait before the next try. Every draw of a missing symbol asks for its
 * pack, and a failed chunk (a deploy moved its hash) is not cached by the bundler, so without the wait every live-data render of
 * every card would fetch it again. The wait doubles from 2 s up to a minute and ends when a fetch succeeds.
 */
const FAILED = new Map<string, { at: number; wait: number }>();
const RETRY_FIRST_MS = 2_000;
const RETRY_MAX_MS = 60_000;
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version += 1;
  for (const l of [...listeners]) l();
};

/** The loader key of a pack file: what a host installs (`kit-runtime.ts`) for `scada-pack-<id>.ts`. */
export const scadaPackLoaderKey = (pack: string): string => `scada-pack-${pack}`;

/**
 * Registers the drawings of a pack file (what its loader resolved to, the pack's `<PACK>_DEFS`). Only the keys the manifest gives
 * that pack are taken, and only their drawing: the metadata is the manifest's. Returns how many were new.
 */
export function registerScadaPack(pack: string, defs: unknown): number {
  LOADED.add(pack);
  WANTED.delete(pack);
  FAILED.delete(pack);
  let added = 0;
  if (defs && typeof defs === 'object') {
    for (const [key, def] of Object.entries(defs as Record<string, unknown>)) {
      const meta = (SCADA_MANIFEST as Readonly<Record<string, ScadaManifestEntry | undefined>>)[key];
      if (!meta || meta.pack !== pack || DRAWN.has(key) || typeof (def as Partial<SymbolDef> | null)?.draw !== 'function') continue;
      DRAWN.set(key, def as SymbolDef);
      added += 1;
    }
  }
  if (added) changed();
  return added;
}

/**
 * Fetches a pack file through the loader the host installed and registers it; true once it is in. Without a loader (the module
 * that serves it is not active, or the host has not installed it yet) it resolves false and waits: the pack is fetched when a
 * loader for it is installed. A failed fetch resolves false and is tried again only after a back-off wait (`FAILED`): an ask
 * inside the wait resolves false with no fetch, and the first ask after it fetches again.
 */
export function loadScadaPack(pack: string): Promise<boolean> {
  if (LOADED.has(pack)) return Promise.resolve(true);
  const busy = LOADING.get(pack);
  if (busy) return busy;
  const failed = FAILED.get(pack);
  // A clock stepped back (negative) does not stretch the wait.
  const since = failed ? Date.now() - failed.at : 0;
  if (failed && since >= 0 && since < failed.wait) return Promise.resolve(false);
  const loader = kitLoader(scadaPackLoaderKey(pack));
  if (!loader) {
    WANTED.add(pack);
    return Promise.resolve(false);
  }
  const done = Promise.resolve()
    .then(loader)
    .then((defs) => { registerScadaPack(pack, defs); return true; }, () => {
      const last = FAILED.get(pack);
      FAILED.set(pack, { at: Date.now(), wait: last ? Math.min(last.wait * 2, RETRY_MAX_MS) : RETRY_FIRST_MS });
      return false;
    })
    .finally(() => { LOADING.delete(pack); });
  LOADING.set(pack, done);
  return done;
}

/** Asks for the drawings of these symbols (keys the library lacks are left out); true once every one of them can be drawn. */
export function ensureScadaSymbols(keys: Iterable<unknown>): Promise<boolean> {
  const known = [...keys].filter(isScadaSymbol);
  const packs = new Set<string>();
  for (const k of known) {
    const pack = scadaPackOf(k);
    if (pack && !LOADED.has(pack)) packs.add(pack);
  }
  return Promise.all([...packs].map(loadScadaPack)).then(() => known.every(scadaSymbolReady));
}

/** Whether a symbol can be drawn now: a base symbol, or one whose pack has arrived. False for a key the library lacks. */
export const scadaSymbolReady = (v: unknown): boolean => isScadaSymbol(v) && DRAWN.has(canonicalSymbol(v));

/** Calls `listener` whenever drawings arrive; returns the unsubscribe. */
export function subscribeScadaRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A number that changes whenever drawings arrive (a `useSyncExternalStore` snapshot; part of a memo's key). */
export const scadaRegistryVersion = (): number => version;

// A pack asked for before its loader was installed is fetched once the host installs one.
subscribeKitRuntime(() => {
  for (const pack of [...WANTED]) void loadScadaPack(pack);
});

/**
 * What a symbol is drawn as while its pack has not arrived, or for a key the library does not have: a quiet dashed frame in the
 * symbol's own box (from the manifest; 100 x 100 for an unknown key), so a diagram keeps its layout and never shows equipment
 * that is not there.
 */
function placeholder(meta: ScadaManifestEntry | undefined, paint: Paint): Drawn {
  const w = r2((meta?.w ?? 100) * (meta?.runs ? paint.length : 1));
  const h = meta?.h ?? 100;
  return {
    w, h,
    nodes: [el('rect', {
      x: 3, y: 3, width: r2(Math.max(1, w - 6)), height: r2(Math.max(1, h - 6)), rx: 6, fill: 'none',
      stroke: MUTED, 'stroke-width': 1.5, 'stroke-dasharray': '6 5', opacity: 0.6, 'data-placeholder': 'symbol',
    })],
  };
}

export type ScadaSettings = {
  symbol?: ScadaSymbol | string;
  orientation?: Orientation | number | string;
  mirror?: boolean;
  length?: 1 | 2 | 3 | number | string;
  maxSize?: number | null;
  min?: number;
  max?: number;
  ticks?: boolean;
  fillColor?: string;
  idleColor?: string;
  runningColor?: string;
  warningColor?: string;
  criticalColor?: string;
  medium?: ScadaMedium | string;
  mediumColor?: string;
  showValue?: boolean;
  showLabel?: boolean;
  label?: string;
  rowLabel1?: string;
  rowLabel2?: string;
  ranges?: unknown;
  animation?: boolean;
  arrows?: boolean;
};

/** What the model needs of the platform: reduced motion and the number words (unit included) of the host. */
export interface ScadaModelOptions {
  animate?: boolean;
  /** `'value2'`: the number is the second reading (`Paint.fmt`). */
  format?: (n: number, field?: 'value2') => string;
}

const bool = (v: unknown): boolean | null => {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null) return false;
  if (v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', '1', 'on', 'yes', 'running', 'open', 'active', 'closed-circuit'].includes(t)) return true;
    if (['false', '0', 'off', 'no', 'stopped', 'closed', 'inactive', ''].includes(t)) return false;
  }
  return null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * The alarm status a source reports. `status` takes the words none / ok / normal, warning / warn, critical / alarm /
 * error / fault, or the numbers 0, 1, 2; a boolean `true` is critical. Alternatively a pair of booleans, `warning`
 * and `critical`; the worse one wins. Nothing bound = none.
 */
export function scadaStatus(status: unknown, warning?: unknown, critical?: unknown): ScadaStatus {
  if (bool(critical) === true) return 'critical';
  const word = typeof status === 'string' ? status.trim().toLowerCase() : status;
  if (typeof word === 'string' && ['critical', 'alarm', 'error', 'fault', 'danger'].includes(word)) return 'critical';
  if (status === true || status === 2 || word === '2') return 'critical';
  if (bool(warning) === true) return 'warning';
  if ((typeof word === 'string' && ['warning', 'warn'].includes(word)) || status === 1 || word === '1') return 'warning';
  return 'none';
}

/** Critical beats warning beats running beats idle. */
export const scadaState = (status: ScadaStatus, running: boolean | null): ScadaState =>
  status === 'critical' ? 'critical' : status === 'warning' ? 'warning' : running ? 'running' : 'idle';

const orientation = (v: unknown): Orientation => {
  const n = Number(v);
  return n === 90 || n === 180 || n === 270 ? n : 0;
};

const MEDIUM_COLOR: Record<string, string | null> = { none: null, cold: 'var(--info)', hot: 'var(--error)', water: 'var(--primary)' };

/** The colour a settings object gives what flows through a connection, or null. */
export function mediumColor(s: ScadaSettings): string | null {
  const m = typeof s.medium === 'string' ? s.medium : 'none';
  return m === 'custom' ? cssColor(s.mediumColor) ?? null : MEDIUM_COLOR[m] ?? null;
}

/** The paint a symbol is drawn with, from its settings and its bound readings. */
export function scadaPaint(s: ScadaSettings, data: Record<string, SlotData | undefined>, o: ScadaModelOptions = {}): Paint {
  const value = num(data.value?.value);
  const min = num(s.min) ?? 0;
  const rawMax = num(data.capacity?.value) ?? num(s.max) ?? 100;
  const max = rawMax > min ? rawMax : min + 1;
  const running = bool(data.running?.value);
  const state = scadaState(scadaStatus(data.status?.value, data.warning?.value, data.critical?.value), running);
  const idle = cssColor(s.idleColor) ?? 'var(--text-secondary)';
  const palette: Record<ScadaState, string> = {
    idle,
    running: cssColor(s.runningColor) ?? 'var(--success)',
    warning: cssColor(s.warningColor) ?? 'var(--warning)',
    critical: cssColor(s.criticalColor) ?? 'var(--error)',
  };
  const color = palette[state];
  return {
    state, color, idle, running: running === true, animate: o.animate !== false && s.animation !== false,
    level: value === null ? null : Math.min(1, Math.max(0, (value - min) / (max - min))),
    // The liquid keeps its own colour until the source reports a warning or an alarm.
    fill: state === 'warning' || state === 'critical' ? color : cssColor(s.fillColor) ?? 'var(--info)',
    bands: rangesToBands(s.ranges),
    min, max, value, value2: num(data.value2?.value), ticks: s.ticks !== false,
    medium: mediumColor(s),
    fmt: o.format ?? ((n) => String(r2(n))),
    rows: [s.rowLabel1?.trim() || 'T1', s.rowLabel2?.trim() || 'T2'],
    length: Math.min(3, Math.max(1, Math.round(Number(s.length) || 1))),
    arrows: s.arrows === true,
    states: readStates((key) => data[key]?.value),
  };
}

/**
 * Draws a symbol by key (turned and flipped as asked): the nodes and their box. A merged key draws as the kept one. A symbol whose
 * pack has not arrived draws the placeholder and asks for its pack (it arrives through `subscribeScadaRegistry`); a key the library
 * does not have draws the placeholder.
 */
export function drawScada(symbol: string, paint: Paint, turn: Orientation = 0, mirror = false): { nodes: SvgNode[]; w: number; h: number } {
  const key = canonicalSymbol(symbol);
  const meta = scadaManifestEntry(key);
  const def = DRAWN.get(key);
  if (!def && meta) void loadScadaPack(meta.pack);
  const drawn = def ? def.draw(paint) : placeholder(meta, paint);
  // Speed and direction act on the drawing before it is turned; the badges are added after, so they never turn or mirror.
  const placed = orient(harmonize(drawn.nodes), drawn.w, drawn.h, turn, mirror);
  // The states layer comes last: badges sit in the corners of the final box and never turn or mirror with the symbol.
  return { nodes: applyStates(placed.nodes, placed.w, placed.h, paint, meta?.family !== 'connection'), w: placed.w, h: placed.h };
}

/**
 * Everything the symbol widget draws, decided once. `animate` is false for a viewer who asks for reduced motion. A key the library
 * does not have draws the placeholder with no name (it used to draw a standing tank).
 */
export function scadaModel(s: ScadaSettings, data: Record<string, SlotData | undefined>, opts: ScadaModelOptions = {}) {
  const meta = scadaManifestEntry(s.symbol);
  const symbol: string = meta ? canonicalSymbol(s.symbol as string) : typeof s.symbol === 'string' ? s.symbol : '';
  const paint = scadaPaint(s, data, opts);
  const placed = drawScada(symbol, paint, orientation(s.orientation), s.mirror === true);
  const running = bool(data.running?.value);
  const status = scadaStatus(data.status?.value, data.warning?.value, data.critical?.value);
  const labelCell = data.label?.value;
  const label = labelCell !== undefined && labelCell !== null && String(labelCell) !== '' ? String(labelCell) : s.label || '';
  return {
    symbol, family: meta?.family ?? null, name: meta?.label ?? '', state: paint.state, status, running, value: paint.value, value2: paint.value2,
    level: paint.level, min: paint.min, max: paint.max,
    /** The drawing is the symbol's own; false while its pack has not arrived, and for a key the library does not have. */
    ready: scadaSymbolReady(symbol),
    /** Only these symbols print the bound number under the drawing. */
    hasValue: !!meta?.valueUnder,
    showValue: s.showValue !== false,
    showLabel: s.showLabel !== false && label !== '',
    label,
    unknown: paint.value === null && paint.value2 === null && running === null && status === 'none',
    maxSize: typeof s.maxSize === 'number' && s.maxSize > 0 ? s.maxSize : null,
    viewBox: `0 0 ${placed.w} ${placed.h}`,
    width: placed.w,
    height: placed.h,
    nodes: placed.nodes,
    states: paint.states,
  };
}

export type ScadaModel = ReturnType<typeof scadaModel>;
