// Rows for a scene (dashboard phase 42.3.1): how the rows of one device, or of several devices of an asset, reach the keys of a scene document. Pure and
// shared by the cards that draw a bound scene: the 3D design card (`dashboard_viewer`) and the 2D process diagram card (`dashboard_scada`). The
// role table (`devices`) and the exceptions (`map`) of a binding are the only table; nothing parses a key to find a device.

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The rows as the view reads them: each element's row under its item id (`items`), the element id kept as `element`. */
export function rowsForDesign(rows: ReadonlyArray<Record<string, unknown>>, items: Readonly<Record<string, string>>): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const element = String(r.id ?? '');
    return { ...r, id: (Object.hasOwn(items, element) ? items[element] : undefined) ?? element, element };
  });
}

/** One named input of a field's expression (slice 16, SU-3): a telemetry key of a bound device, `deviceId` absent: the field's device. */
export interface FieldInput {
  deviceId?: string;
  key: string;
}

/**
 * One field of a symbol read from one telemetry key (phase 45, D45-3), as the binding stores it (`SceneFieldRead` of `scene-binding.ts`). Since slice 16 the
 * key may be absent when the field is an expression over its named `inputs` (the raw row then has no value for the field; the convert lays the result over it).
 */
export interface FieldRead {
  deviceId?: string;
  key?: string;
  label?: string;
  /** One convert expression over `value`, `row`, `now` and the named `inputs` (phase 45.3, slice 16): applied by `useSceneConvert` after the row is assembled, never by `sceneRows`. */
  script?: string;
  inputs?: Readonly<Record<string, FieldInput>>;
}

/** One map entry (`SceneMapEntry`): the element shortcut, the field map, or both. The pre-45 shape `{ deviceId, element }` is one of them. */
export interface MapEntry {
  deviceId?: string;
  element?: string;
  fields?: Readonly<Record<string, FieldRead>>;
}

/**
 * The part of a binding the card draws with (`SceneBindingView` of the dashboard): the equipment roles (role to device id, `""` the main
 * role), the exceptions to the identity (scene key to the device's element) and the field maps (scene key to the telemetry keys its fields read, phase 45),
 * and the keys the subject hides.
 */
export interface BindingRows {
  devices: Readonly<Record<string, string>>;
  map: Readonly<Record<string, MapEntry>>;
  hidden?: readonly string[] | null;
}

/**
 * The latest value of one telemetry key, with the unit and decimals its profile declares when the read said them (e2e run 1, E12): a drawing formats the
 * symbol's number with them unless the symbol sets its own.
 */
export interface LatestPoint {
  value: unknown;
  ts?: string | number;
  unit?: string;
  decimals?: number;
}

/** The latest value of every telemetry key a card read, by device id (lower case) and key: what a field map is assembled from. */
export type LatestByDevice = Readonly<Record<string, Readonly<Record<string, LatestPoint>>>>;

/**
 * The columns a scene row carries the unit and decimals of its `value` in (e2e run 1, E12): from the profile of the key the value is read from (the element's
 * `<element>.value`, or a field map's key). The process diagram formats the symbol's numbers with them unless the symbol sets its own Unit / Decimals.
 */
export const ROW_UNIT = 'unit';
export const ROW_DECIMALS = 'decimals';

/** The unit and decimals of a key's latest point, as a row carries them (none for a point that says neither). Pure. */
export function readingFormatOf(point: LatestPoint | undefined): { unit?: string; decimals?: number } {
  if (!point) return {};
  return { ...(typeof point.unit === 'string' && point.unit ? { unit: point.unit } : {}), ...(typeof point.decimals === 'number' ? { decimals: point.decimals } : {}) };
}

/**
 * The fields of the `<element>.<field>` telemetry convention (`iot_telemetry`'s `ELEMENT_FIELDS`, the symbol vocabulary of the widget kit's
 * `SCENE_COLUMNS`): a key `pool.value` is the element `pool`'s `value`. Repeated here, not imported: the dashboard imports nothing of the IoT modules,
 * and the kit's list sits behind the whole symbol library.
 */
export const ELEMENT_ROW_FIELDS: ReadonlySet<string> = new Set([
  'value', 'value2', 'running', 'status', 'warning', 'critical', 'label', 'capacity', 'mode', 'quality', 'speed', 'direction', 'ack', 'position', 'pending', 'failed',
]);

/**
 * The element rows of the devices' latest keys (e2e round 2, E2E-2.4): the rows `iot_telemetry`'s `elements` source would answer, derived on the
 * client from `latest` (every key of the shape `<element>.<field>` with a field of the convention), one row per device and element: `{ id: element,
 * element, deviceId, <field>: value, ts: the newest }`. A drawing shown where no table slot is bound (the device page's Scene tab, a card that names
 * its device alone) draws its element exceptions and identity symbols from these; a flat key (`temperature`) makes no row and is a field map's.
 * Devices and elements come out sorted, so the rows are stable between polls.
 */
export function elementRowsOf(latest: LatestByDevice | undefined): Array<Record<string, unknown>> {
  if (!latest) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const device of Object.keys(latest).sort()) {
    const byElement = new Map<string, { row: Record<string, unknown>; at: number; ts?: string | number }>();
    for (const key of Object.keys(latest[device]).sort()) {
      const dot = key.lastIndexOf('.');
      if (dot <= 0 || dot === key.length - 1) continue;
      const element = key.slice(0, dot);
      const field = key.slice(dot + 1);
      if (!ELEMENT_ROW_FIELDS.has(field) || element.includes('.')) continue;
      const point = latest[device][key];
      if (point === undefined || point.value === undefined) continue;
      const entry = byElement.get(element) ?? { row: { id: element, element, deviceId: device }, at: -Infinity };
      entry.row[field] = point.value;
      // the unit and decimals of the element's reading (E12)
      if (field === 'value') Object.assign(entry.row, readingFormatOf(point));
      const at = tsOf(point.ts);
      if (point.ts !== undefined && (entry.ts === undefined || (Number.isFinite(at) && at > entry.at))) { entry.at = Number.isFinite(at) ? at : -Infinity; entry.ts = point.ts; }
      byElement.set(element, entry);
    }
    for (const e of byElement.values()) out.push(e.ts !== undefined ? { ...e.row, ts: e.ts } : e.row);
  }
  return out;
}

/** Whether an entry has a field map with at least one field. */
export const entryHasFields = (e: MapEntry | undefined): e is MapEntry & { fields: Readonly<Record<string, FieldRead>> } => !!e?.fields && Object.keys(e.fields).length > 0;

/** Whether a binding has any field map to assemble (the card then reads the latest keys of its devices). */
export const bindingHasFields = (binding: BindingRows | null | undefined): boolean => !!binding && Object.values(binding.map).some(entryHasFields);

/** The role table as the row functions read it: the roles sorted, the device of each role lower-cased, the main device. */
function roleTable(devices: Readonly<Record<string, string>>): { roles: string[]; roleOfDevice: Map<string, string>; main: string | undefined; deviceOfRole: (role: string) => string | undefined } {
  const roles = Object.keys(devices).sort();
  const roleOfDevice = new Map<string, string>();
  for (const role of roles) {
    const id = devices[role].toLowerCase();
    if (!roleOfDevice.has(id)) roleOfDevice.set(id, role);
  }
  const main = (devices[''] ?? (roles.length === 1 ? devices[roles[0]] : undefined))?.toLowerCase();
  return { roles, roleOfDevice, main, deviceOfRole: (role) => (Object.hasOwn(devices, role) ? devices[role].toLowerCase() : undefined) };
}

/** The role a key is prefixed with (the longest named role that fits, so `fry.a` and `fryer.a` stay apart) and the rest; the main role for a bare key. */
function splitRole(key: string, devices: Readonly<Record<string, string>>): { role: string; local: string } {
  const roles = Object.keys(devices).filter((r) => r !== '').sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  for (const role of roles) if (key.length > role.length + 1 && key.startsWith(`${role}.`)) return { role, local: key.slice(role.length + 1) };
  return { role: '', local: key };
}

/**
 * The device a field is read from (phase 45, SM2-3): its own `deviceId`, else the entry's, else the device of the key's role prefix, else the main
 * device; lower-cased; undefined when none of them says.
 */
export function fieldDeviceOf(binding: BindingRows, key: string, entry: MapEntry, field: FieldRead): string | undefined {
  const { main, deviceOfRole } = roleTable(binding.devices);
  const own = field.deviceId ?? entry.deviceId;
  if (own) return own.toLowerCase();
  return deviceOfRole(splitRole(key, binding.devices).role) ?? main;
}

/** The device one named input of a field is read from (slice 16): its own `deviceId`, else the field's (`fieldDeviceOf`); lower-cased. */
export function inputDeviceOf(binding: BindingRows, key: string, entry: MapEntry, field: FieldRead, input: FieldInput): string | undefined {
  return input.deviceId ? input.deviceId.toLowerCase() : fieldDeviceOf(binding, key, entry, field);
}

/**
 * What a binding's field maps read (phase 45): the devices (lower-cased, only those of the role table: a field never reads a device the binding does
 * not hold) and the distinct telemetry keys, both sorted; the named inputs of an expression (slice 16) are read in the same batch. Empty when the binding
 * has no field map; what the card asks the latest-keys read for. With `allKeys` (E2E-2.4), every bound device and no key filter: the whole latest list,
 * for a drawing that derives its element rows from it.
 */
export function fieldReadsOf(binding: BindingRows | null | undefined, o: { allKeys?: boolean } = {}): { devices: string[]; keys: string[] } {
  if (!binding) return { devices: [], keys: [] };
  const bound = new Set(Object.values(binding.devices).map((d) => d.toLowerCase()));
  // every key of every bound device (E2E-2.4): what a drawing with no table slot derives its element rows from (`elementRowsOf`); no key filter
  if (o.allKeys) return { devices: [...bound].sort(), keys: [] };
  const devices = new Set<string>();
  const keys = new Set<string>();
  const take = (d: string | undefined, k: string) => {
    if (d !== undefined && bound.has(d)) {
      devices.add(d);
      keys.add(k);
    }
  };
  for (const key of Object.keys(binding.map)) {
    const e = binding.map[key];
    if (!entryHasFields(e)) continue;
    for (const f of Object.keys(e.fields)) {
      const read = e.fields[f];
      if (read.key !== undefined) take(fieldDeviceOf(binding, key, e, read), read.key);
      for (const input of Object.values(read.inputs ?? {})) take(inputDeviceOf(binding, key, e, read, input), input.key);
    }
  }
  return { devices: [...devices].sort(), keys: [...keys].sort() };
}

/** The latest value of one input (slice 16), or undefined when its device was not read or has not sent the key. */
export function inputValueFrom(latest: LatestByDevice | undefined, device: string | undefined, key: string): { value: unknown; ts?: string | number } | undefined {
  if (!latest || device === undefined || !Object.hasOwn(latest, device)) return undefined;
  return own(latest[device], key);
}

const tsOf = (ts: string | number | undefined): number => (typeof ts === 'number' ? ts : typeof ts === 'string' ? Date.parse(ts) : NaN);

/**
 * The row a field map assembles for a scene key (phase 45, D45-3, 45.2.2): each field's value from the latest value of the key it names on the device it
 * reads (`fieldDeviceOf`); a key the device has not sent, or a device not read, leaves the field out (undefined: the symbol keeps what it has; never a
 * throw, never a fake 0); `ts` is the newest of the values read. `deviceId` is the entry's device, else the device of the first field that has one.
 * Null when no field has a value and the entry has no device to name.
 */
export function fieldRowOf(binding: BindingRows, key: string, entry: MapEntry, latest: LatestByDevice | undefined): Record<string, unknown> | null {
  if (!entryHasFields(entry)) return null;
  const out: Record<string, unknown> = {};
  let newest: { at: number; ts: string | number } | undefined;
  let deviceId: string | undefined = entry.deviceId?.toLowerCase();
  let any = false;
  const reads: Array<{ field: string; device: string; key: string }> = [];
  for (const field of Object.keys(entry.fields)) {
    const read = entry.fields[field];
    const device = fieldDeviceOf(binding, key, entry, read);
    if (device === undefined) continue;
    deviceId ??= device;
    // an expression-only field (no key, slice 16) has no raw value: the convert lays its result over the row
    if (read.key === undefined) continue;
    reads.push({ field, device, key: read.key });
    const point = latest && Object.hasOwn(latest, device) ? own(latest[device], read.key) : undefined;
    if (point === undefined || point.value === undefined) continue;
    out[field] = point.value;
    any = true;
    const at = tsOf(point.ts);
    if (point.ts !== undefined && (newest === undefined || (Number.isFinite(at) && at > newest.at))) newest = { at: Number.isFinite(at) ? at : -Infinity, ts: point.ts };
  }
  if (!any && deviceId === undefined) return null;
  // the keys the symbol's fields read of the row's own device (`field=key`, comma-joined), so a click on the symbol can open its equipment panel on the
  // values it shows instead of the element convention (e2e round 4, M-R4-01: the panel of a connected symbol said the device sends nothing for it)
  const readsKeys = reads.filter((r) => r.device === deviceId).map((r) => `${r.field}=${r.key}`).join(',');
  // E12: the unit and decimals of the key the symbol's number reads; a converted value (an expression) is another quantity, so it carries none
  const valueRead = reads.find((r) => r.field === 'value');
  const format = valueRead && entry.fields.value?.script === undefined && latest && Object.hasOwn(latest, valueRead.device) ? readingFormatOf(own(latest[valueRead.device], valueRead.key)) : {};
  return { ...out, id: key, ...(deviceId !== undefined ? { deviceId } : {}), ...(newest ? { ts: newest.ts } : {}), ...(readsKeys ? { readsKeys } : {}), ...format };
}

/** A row without the unit and decimals of its reading (`ROW_UNIT`, `ROW_DECIMALS`). Pure. */
function withoutReadingFormat(r: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(r, ROW_UNIT) && !Object.hasOwn(r, ROW_DECIMALS)) return r;
  const { [ROW_UNIT]: _unit, [ROW_DECIMALS]: _decimals, ...rest } = r;
  return rest;
}

const deviceOfRow = (r: Record<string, unknown>): string | undefined => (typeof r.deviceId === 'string' && r.deviceId !== '' ? r.deviceId.toLowerCase() : undefined);

/**
 * Whether the rows are of more than one device (they name their `deviceId`, from `elements` over an asset's devices): with no binding to say
 * which device's element is which item, a bare element id is ambiguous, and the card must not guess.
 */
export function rowsAreAmbiguous(rows: ReadonlyArray<Record<string, unknown>>): boolean {
  const devices = new Set<string>();
  for (const r of rows) {
    const d = deviceOfRow(r);
    if (d !== undefined) devices.add(d);
  }
  return devices.size > 1;
}

const own = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/**
 * The rows as the view reads them, each under the scene key that names its item (`id`), the element kept as `element`.
 *
 * With a binding, per row (a row names its device in `deviceId`; one without is the main device's, or the only device's):
 *  1. a row of a device the binding does not hold is left out (it belongs to another scene);
 *  2. an exception of the binding's `map` (the device's element to a scene key) wins;
 *  3. else the identity: the element, prefixed with the device's role (`fryer.heater`) when the role is not the main one;
 *  4. in a design without keys that key is looked up in `items` (the card's element to item id map, the 2D import's report), as before;
 *     an exception names the item (the key of a design without keys is its item id) and is not looked up.
 *    The card's `items` serve a binding only when it names the design the card itself is set to (`cardItemsApply`): they are that design's.
 * Without a binding the card's own settings decide: the identity for a keyed design, `items` for one without keys (`rowsForDesign`). Unless
 * the rows are of several devices (`rowsAreAmbiguous`): a bare element id then stands for several devices' elements and the last would
 * win, so those rows are left out (never a guess); the card says the scene needs setting up.
 *
 * The field maps (phase 45, D45-3, 45.2.2), with a binding: for every entry of `map` with `fields` (and, in a keyed design, a key the document has), a row is
 * ASSEMBLED from the named telemetry keys (`fieldRowOf` over `latest`, the latest values of the binding's devices the card read), and laid OVER the row the
 * steps above put under that key (the element row of an exception, else the identity's): a field's value wins, the element row fills the rest, the
 * identity below that. A field whose key has no value stays undefined. A key with fields and no row from the steps above gets the assembled row alone,
 * so a flat device (`temperature`, `humidity`, no element at all) drives a symbol. Without `latest` the field maps add nothing but the entry's device.
 */
export function sceneRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  o: {
    binding: BindingRows | null; items: Readonly<Record<string, string>>; keyed: boolean;
    /** The keys of the keyed design: a `map` entry whose key is not one of them names an item that is not there and is ignored. */
    keys?: ReadonlySet<string>;
    /** Whether the card's `items` belong to the design the binding names (`cardItemsApply`); false: only the map or the identity. Default true. */
    itemsApply?: boolean;
    /** The latest values of the binding's devices by device and telemetry key (phase 45): what the field maps are assembled from. */
    latest?: LatestByDevice;
  },
): Array<Record<string, unknown>> {
  const { binding, keyed } = o;
  const items = binding && o.itemsApply === false ? {} : o.items;
  if (!binding) {
    const usable = rowsAreAmbiguous(rows) ? rows.filter((r) => deviceOfRow(r) === undefined) : rows;
    return keyed ? usable.map((r) => ({ ...r, element: String(r.element ?? r.id ?? '') })) : rowsForDesign(usable, items);
  }
  const { roles, roleOfDevice, main } = roleTable(binding.devices);
  const exception = new Map<string, string>();
  const fieldKeys: string[] = [];
  for (const key of Object.keys(binding.map).sort()) {
    // a keyed design is matched by key: an exception to a key the document does not have (a map written for the design before it was keyed) is stale
    if (keyed && o.keys && !o.keys.has(key)) continue;
    const e = binding.map[key];
    if (entryHasFields(e)) fieldKeys.push(key);
    // the element shortcut: that element of that device is this key's row (an entry with fields alone names no element)
    if (e.element === undefined) continue;
    const at = `${(e.deviceId ?? main ?? '').toLowerCase()}\n${e.element}`;
    if (!exception.has(at)) exception.set(at, key);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const element = String(r.element ?? r.id ?? '');
    const named = typeof r.deviceId === 'string' && r.deviceId !== '' ? r.deviceId.toLowerCase() : undefined;
    const device = named ?? main;
    const hit = device === undefined ? undefined : exception.get(`${device}\n${element}`);
    const role = device === undefined ? undefined : roleOfDevice.get(device);
    if (hit === undefined && named !== undefined && role === undefined && roles.length > 0) continue;
    const sceneKey = hit ?? (role ? `${role}.${element}` : element);
    // an exception names the item itself; a design without keys otherwise finds its item through the card's own element to item map
    const id = keyed || hit !== undefined ? sceneKey : own(items, sceneKey) ?? own(items, element) ?? sceneKey;
    out.push({ ...r, id, element });
  }
  // the field maps: assembled from the latest keys, laid over the row the key already has (the first one, when several rows landed under it), or added
  for (const key of fieldKeys) {
    const assembled = fieldRowOf(binding, key, binding.map[key], o.latest);
    if (!assembled) continue;
    const at = out.findIndex((r) => r.id === key);
    // a field map that reads the symbol's `value` from another key brings that key's unit and decimals, never the element row's (E12)
    if (at >= 0) out[at] = { ...(Object.hasOwn(binding.map[key].fields ?? {}, 'value') ? withoutReadingFormat(out[at]) : out[at]), ...assembled, id: key };
    else out.push(assembled);
  }
  return out;
}

/**
 * The device and element a symbol's scene key reads when a field of it has no read of its own (the identity `sceneRows` lays rows under, read the other way
 * round): the entry's element exception (that element of the entry's device, else the main device), else the role prefix (`tea.water_kettle`: the device of
 * the `tea` role, the element `water_kettle`), else the main device and the bare key as the element. The device is lower-cased; null when the binding names
 * none for it. A field of such a symbol is read from the element's key `<element>.<field>` of that device (the telemetry elements convention), which is how
 * the card draws it with no field map; the side panel uses this to show where a symbol that works by itself reads from.
 */
export function symbolIdentity(binding: Pick<BindingRows, 'devices'>, key: string, entry?: Pick<MapEntry, 'deviceId' | 'element'>): { deviceId: string; element: string } | null {
  const { main, deviceOfRole } = roleTable(binding.devices);
  if (entry?.element !== undefined) {
    const id = (entry.deviceId ?? main)?.toLowerCase();
    return id ? { deviceId: id, element: entry.element } : null;
  }
  const { role, local } = splitRole(key, binding.devices);
  const id = role === '' ? main : deviceOfRole(role);
  return id ? { deviceId: id, element: local } : null;
}

/**
 * What a scene key stands for under a binding, or null when the binding does not say: an exception of `map` (the key names the device's
 * element), else a role-prefixed key `<role>.<element>` (the longest role that fits, so `fry.a` and `fryer.a` stay apart). The main
 * role's bare keys are the identity and say nothing here. Nothing parses a key for a device: the roles and the map are the table.
 * An entry with fields alone (phase 45) names its device (its own, else the first field's) and no element: the key's own local part stands
 * for the element then, as the identity would (a flat device has no element; the equipment panel of 45.5 shows the device's data).
 */
export function keyTarget(binding: BindingRows, key: string): { deviceId: string; element: string } | null {
  const hit = own(binding.map, key);
  if (hit && hit.element !== undefined) return { deviceId: hit.deviceId ?? roleTable(binding.devices).main ?? '', element: hit.element };
  const { role, local } = splitRole(key, binding.devices);
  if (hit && entryHasFields(hit)) {
    const first = Object.keys(hit.fields)[0];
    const deviceId = fieldDeviceOf(binding, key, hit, hit.fields[first]);
    return deviceId ? { deviceId, element: local } : null;
  }
  if (role !== '') return { deviceId: binding.devices[role], element: local };
  return null;
}

/** The label a click names: the card's own for the scene key (several devices may hold an element of one id), else for the element, else the row's. */
const labelOf = (labels: Readonly<Record<string, string>>, key: string, element: string, row?: Record<string, unknown>): string =>
  own(labels, key) ?? own(labels, element) ?? str(row?.label) ?? element;

/**
 * The row a click on the item `key` (the scene key the rows were put under) fires, or null when no row is under it. Its `id` is the
 * element, as `clickRow`'s, and it carries `element` and, when the row names its device (several devices), `deviceId`: a page that
 * opens the equipment of the right device sets its parameters from those two.
 */
export function sceneClickRow(
  key: string, rows: ReadonlyArray<Record<string, unknown>>, labels: Readonly<Record<string, string>>,
): Record<string, unknown> | null {
  const row = rows.find((r) => String(r.id ?? '') === key);
  if (!row) return null;
  const { element: _element, ...rest } = row;
  // a row assembled from a field map names no element: the click keeps the symbol's key as its id (e2e round 4, M-R4-02: an empty id opened nothing)
  const element = typeof _element === 'string' && _element !== '' ? _element : key;
  return { ...rest, id: element, element, label: labelOf(labels, key, element, row) };
}

/**
 * The row of a click on an item no live row is under, when the binding itself says which element of which device it is (a map exception
 * or a role-prefixed key): `{ id, element, deviceId, label }`. Null when it does not (the card's own items decide, `clickRow`).
 */
export function clickTargetRow(binding: BindingRows | null, key: string, labels: Readonly<Record<string, string>>): Record<string, unknown> | null {
  const target = binding ? keyTarget(binding, key) : null;
  if (!target) return null;
  return { id: target.element, element: target.element, deviceId: target.deviceId, label: labelOf(labels, key, target.element) };
}


/**
 * The saved entries of a binding a KEYED document no longer has (TK-6): the keys of its `map` exceptions and of its `hidden` list that are not keys of the
 * document. `sceneRows` skips such an exception and the viewer ignores such a hidden key, so nothing breaks, but it is no longer what was set up; the cards
 * count them in their "the drawing changed" notice and the Scene drawer lists them. A document matched by item id (a design without keys) has none to count
 * (`keyed` false), and so does a binding with nothing saved. Shared by the 3D design card and the 2D diagram card (SP-9).
 */
export function staleBindingKeys(binding: { map?: Readonly<Record<string, unknown>>; hidden?: readonly string[] | null } | null, keys: ReadonlySet<string>, keyed: boolean): string[] {
  if (!binding || !keyed) return [];
  const stale = new Set<string>();
  for (const k of Object.keys(binding.map ?? {})) if (!keys.has(k)) stale.add(k);
  for (const k of binding.hidden ?? []) if (!keys.has(k)) stale.add(k);
  return [...stale];
}

/** A scene answer as the cards read it (`useSceneBinding`'s state): the part the changed-drawing test needs. */
export interface SceneAnswerHashes {
  status: string;
  answer?: { binding?: { status: string; documentHash?: string | null } | null; document?: { hash?: string | null } | null } | null;
}

/**
 * Whether the drawing a card draws is another version than the one its binding was set up on (TK-6, SP-9): the binding is `ok` (a broken one has its own
 * message), the answer is in, and BOTH fingerprints are known and differ. A fingerprint that is not known on either side is "cannot tell", never "changed" (SM-13).
 * Pure, and the one function both cards call; the Scene drawer compares with the kit's `documentChanged`, which is the same test (a test pins the two together).
 */
export function drawingChangedOf(read: SceneAnswerHashes): boolean {
  const binding = read.answer?.binding;
  if (read.status !== 'ready' || binding?.status !== 'ok') return false;
  const saved = binding.documentHash;
  const current = read.answer?.document?.hash;
  return !!saved && !!current && saved !== current;
}

/**
 * How many saved connections of a setup no longer match the drawing it is drawn with (D596; 52.3.2, test 3 #21, #60, #82, #176, #222): its map
 * exceptions and hidden keys that name a key the drawing has lost (`staleBindingKeys`), counted only while the drawing is another version than the
 * setup was made on (`drawingChangedOf`) and once the drawing's keys are known and it has some (a drawing still loading, one with nothing drawn yet and
 * a design matched by item id have no keys: every entry would look stale). 0 is "nothing to review": a rule-only change, a moved symbol and the first
 * save of a blank drawing stale no connection. The ONE test the Views' "drawing changed" strip and both cards' notices (SP-9, SF-4, SF-5) show by, so
 * a card says it exactly when the Views its Review opens show the strip. `keys`: the drawing's keys, null while they are not known. Pure.
 */
export function staleConnectionCount(
  read: SceneAnswerHashes,
  binding: { map?: Readonly<Record<string, unknown>>; hidden?: readonly string[] | null } | null | undefined,
  keys: ReadonlySet<string> | null,
): number {
  if (!binding || !keys || keys.size === 0 || !drawingChangedOf(read)) return 0;
  return staleBindingKeys(binding, keys, true).length;
}
