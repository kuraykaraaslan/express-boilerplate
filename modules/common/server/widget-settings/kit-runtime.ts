// NB-owned, never vendored: next-boilerplate's own file in the kit's tree. scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The kit's runtime parts that a host installs (pure, no React): `() => import()` loaders of code the kit does not carry itself,
// and the lock state of options the viewer may not add. The kit asks for a loader by its key when it needs that code (the
// process symbols ask for a pack file, `scada-logic.ts`), and reads the lock of an option by its value. Who installs what is the
// host's business: NB's dashboard installs what the modules active for the tenant contribute to `dashboard:kit_runtime`, so a
// tenant without such a module never has the loader and never downloads that code.
//
// One store per page (a module singleton), keyed by the installing source (a module id), so a source can be replaced or removed
// as a whole. Installing what is already installed changes nothing and tells nobody.

/** A loader of code the kit does not carry: resolves to what the asking part of the kit expects (a pack file's definitions). */
export type KitLoader = () => Promise<unknown>;

/**
 * Why an option of the kit (a select option, a palette tile: its value) may be shown and kept but not newly added. A part of the
 * kit that draws options never draws a locked one's own drawing (that would load its code): it draws the option's `picture`, or a
 * neutral placeholder until there is one.
 */
export interface KitOptionLock {
  locked: true;
  /** Why it is locked, in the viewer's language: the tile's tooltip and its screen-reader text. */
  title?: string;
  /** What opens it, for the lock's link ("Get Home"); opened in a new tab, so an editor's draft is not lost. */
  offer?: { label: string; href?: string };
  /**
   * The key of a loader (installed like any other) that resolves to static pictures of options by value (SVG markup). The kit asks
   * for it the first time it draws a locked option that names it (`kitOptionPicture`).
   */
  picture?: string;
}

/** Locks by option value. An option that is not listed is open. */
export type KitOptionLocks = Readonly<Record<string, KitOptionLock>>;

export interface KitRuntimeParts {
  /** Loaders by the kit's key for the code (a pack file's name). */
  loaders?: Readonly<Record<string, KitLoader>>;
  /**
   * The lock state of options; null = every option open. Absent keeps the locks the source already has (none: every option
   * open): a host that cannot tell (one without a tenant) never decides them, so it cannot reopen what a tenant's host locked.
   */
  locks?: KitOptionLocks | null;
}

/**
 * Who the page asks for code as (dashboard phase 33): the tenant of the page and, on a display link's screen, its token. A loader of
 * a protected pack reads it to ask its module's ticket route with the right credentials; the kit itself never reads it. A host sets
 * the parts it knows (the dashboard's kit host the tenant, the display screen its token).
 */
export interface KitRequestContext {
  tenantId?: string;
  displayToken?: string;
}

let requestContext: KitRequestContext = {};

/** Sets the parts of the request context given (an `undefined` part is left as it is; `null` clears it). */
export function setKitRequestContext(next: { tenantId?: string | null; displayToken?: string | null }): void {
  const merged: Record<string, string | undefined> = { ...requestContext };
  for (const key of ['tenantId', 'displayToken'] as const) {
    const value = next[key];
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  requestContext = merged as KitRequestContext;
}

/** The request context the page set (see {@link KitRequestContext}). */
export const kitRequestContext = (): KitRequestContext => requestContext;

const installed = new Map<string, KitRuntimeParts>();
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version += 1;
  for (const l of [...listeners]) l();
};

/** Installs (or replaces) what `source` contributes. Nothing happens, and nobody is told, when it is what is already there. */
export function installKitRuntime(source: string, parts: KitRuntimeParts): void {
  const had = installed.get(source);
  const locks = parts.locks === undefined ? had?.locks ?? null : parts.locks;
  if (had && had.loaders === parts.loaders && (had.locks ?? null) === locks) return;
  installed.set(source, { loaders: parts.loaders, locks });
  changed();
}

/** Removes what `source` installed (its module is no longer active). Code already loaded stays loaded. */
export function uninstallKitRuntime(source: string): void {
  if (installed.delete(source)) changed();
}

/** The loader installed for `key`, the first source's when two serve it; undefined when no source serves it. */
export function kitLoader(key: string): KitLoader | undefined {
  for (const parts of installed.values()) {
    const loader = parts.loaders && Object.hasOwn(parts.loaders, key) ? parts.loaders[key] : undefined;
    if (loader) return loader;
  }
  return undefined;
}

/** The lock of an option, by its value; undefined = open. */
export function kitOptionLock(option: string): KitOptionLock | undefined {
  for (const parts of installed.values()) {
    const lock = parts.locks && Object.hasOwn(parts.locks, option) ? parts.locks[option] : undefined;
    if (lock) return lock;
  }
  return undefined;
}

// ─── Static pictures of locked options ────────────────────────────────────────

/** What each picture loader resolved to, by loader key. */
const pictures = new Map<string, Readonly<Record<string, string>>>();
/** Picture loaders being fetched. */
const picturesLoading = new Set<string>();
/** When a picture loader last failed: it is asked again only after a wait (every draw of a locked option asks). */
const picturesFailed = new Map<string, number>();
const PICTURE_RETRY_MS = 30_000;

function loadPictures(key: string): void {
  if (picturesLoading.has(key)) return;
  const failedAt = picturesFailed.get(key);
  // A clock stepped back (negative) does not stretch the wait.
  if (failedAt !== undefined && Date.now() - failedAt >= 0 && Date.now() - failedAt < PICTURE_RETRY_MS) return;
  const loader = kitLoader(key);
  if (!loader) return;
  picturesLoading.add(key);
  Promise.resolve()
    .then(loader)
    .then((value) => {
      pictures.set(key, value && typeof value === 'object' ? (value as Record<string, string>) : {});
      picturesFailed.delete(key);
      changed();
    }, () => { picturesFailed.set(key, Date.now()); })
    .finally(() => { picturesLoading.delete(key); });
}

/**
 * The static picture of a locked option (SVG markup) from the picture loader its lock names; undefined for an open option, a lock
 * without a picture, an option the pictures lack, or while they have not arrived (the first ask fetches them; their arrival is a
 * change, so subscribers draw again).
 */
export function kitOptionPicture(option: string): string | undefined {
  const key = kitOptionLock(option)?.picture;
  if (!key) return undefined;
  const loaded = pictures.get(key);
  if (loaded) return Object.hasOwn(loaded, option) ? loaded[option] : undefined;
  loadPictures(key);
  return undefined;
}

// ─── Who wants locks ──────────────────────────────────────────────────────────

let locksWanted = false;

/**
 * Says that a part of the kit that shows option locks is on the page (a palette, a select drawn with option pictures). A source
 * whose locks cost a request (asking the server what a tenant holds) works them out only once one is, so a page that only draws
 * cards never asks. The first call is a change; later calls do nothing.
 */
export function wantKitOptionLocks(): void {
  if (locksWanted) return;
  locksWanted = true;
  changed();
}

/** Whether a part that shows option locks has been on the page (`wantKitOptionLocks`). */
export const kitOptionLocksWanted = (): boolean => locksWanted;

/** Calls `listener` after every change of what is installed; returns the unsubscribe. */
export function subscribeKitRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A number that changes with every change of what is installed (a `useSyncExternalStore` snapshot). */
export const kitRuntimeVersion = (): number => version;
