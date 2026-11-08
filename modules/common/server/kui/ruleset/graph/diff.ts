// Vendored from kui-react b380c95: modules/app/RulesetEditor/graph/diff.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-ruleset.mjs).
/**
 * What a deploy changes: the router's `flowlib.js` `diff`, ported. Two flows in the
 * `roltek-automation-1` shape go in; the change list per node and field, per connection and per group comes out.
 * A moved node is listed apart (`moved`): layout is not a change of what the flow does.
 *
 * Differences to the router, on purpose: field keys are paths (`type`, `name`, `disabled`, `v`, `params.<key>`), so a
 * param named `type` cannot be mistaken for the node's type; a node's `v` (the params version) is compared; connections
 * and groups are listed by key instead of counted; every list is sorted by id.
 *
 * This file imports nothing, so a host can copy it alone (next-boilerplate's server reads it).
 */

export type DiffNode = {
  id: string; type?: string; name?: string; disabled?: boolean; v?: number;
  params?: Record<string, unknown>; x?: number; y?: number; [key: string]: unknown;
};
export type DiffEdge = { from: string; from_port?: string; to: string };
export type DiffGroup = { id: string; [key: string]: unknown };
/** a flow, the parts the diff reads */
export type DiffItem = {
  name?: unknown; description?: unknown;
  nodes?: readonly DiffNode[]; edges?: readonly DiffEdge[]; groups?: readonly DiffGroup[];
};

/** one changed field; `from` and `to` are short display texts (at most 60 characters) */
export type DiffFieldChange = { key: string; from: string; to: string };
export type DiffNodeRef = { id: string; type: string; name: string };
export type DiffNodeChange = DiffNodeRef & { fields: DiffFieldChange[] };
export type DiffEdgeRef = { key: string; from: string; from_port: string; to: string };

export type FlowDiff = {
  /** there was no earlier version */
  isNew: boolean;
  /** flow fields: `name`, `description` */
  meta: DiffFieldChange[];
  nodes: { added: DiffNodeRef[]; removed: DiffNodeRef[]; changed: DiffNodeChange[]; moved: string[] };
  edges: { added: DiffEdgeRef[]; removed: DiffEdgeRef[] };
  groups: { added: string[]; removed: string[]; changed: string[] };
  /** every entry above, moved nodes included; 0 means the two are the same */
  total: number;
};

/** Key-sorted JSON: equal values give equal text whatever their key order. `undefined` reads as null. */
export function stableJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).filter((k) => record[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + stableJson(record[k])).join(',') + '}';
}

/** a value as a short text for a change list */
export function shortText(value: unknown): string {
  const s = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

/** the key of a connection: source node, source port (default `out`), target node */
export function edgeKey(from: string, port: string | undefined, to: string): string {
  return `${from}\u0000${port || 'out'}\u0000${to}`;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const META_KEYS = ['name', 'description'] as const;

/** `a`: the earlier version (null for a new item), `b`: the new one. Pure. */
export function diffFlows(a: DiffItem | null | undefined, b: DiffItem): FlowDiff {
  const out: FlowDiff = {
    isNew: !a, meta: [],
    nodes: { added: [], removed: [], changed: [], moved: [] },
    edges: { added: [], removed: [] },
    groups: { added: [], removed: [], changed: [] },
    total: 0,
  };
  const before: DiffItem = a ?? { nodes: [], edges: [], groups: [] };
  for (const k of META_KEYS) {
    const x = before[k], y = b[k];
    // a description that was never set and is still empty is no change
    if (stableJson(x) !== stableJson(y) && !(k === 'description' && x == null && !y)) out.meta.push({ key: k, from: shortText(x), to: shortText(y) });
  }

  const old = new Map((before.nodes ?? []).filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n]));
  const now = new Map((b.nodes ?? []).filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n]));
  const ref = (n: DiffNode): DiffNodeRef => ({ id: n.id, type: String(n.type ?? ''), name: typeof n.name === 'string' ? n.name : '' });
  for (const [id, n] of now) {
    const o = old.get(id);
    if (!o) { out.nodes.added.push(ref(n)); continue; }
    const fields: DiffFieldChange[] = [];
    if ((o.type ?? '') !== (n.type ?? '')) fields.push({ key: 'type', from: String(o.type ?? ''), to: String(n.type ?? '') });
    if ((o.name || '') !== (n.name || '')) fields.push({ key: 'name', from: o.name || '', to: n.name || '' });
    if (!!o.disabled !== !!n.disabled) fields.push({ key: 'disabled', from: String(!!o.disabled), to: String(!!n.disabled) });
    if ((o.v ?? null) !== (n.v ?? null)) fields.push({ key: 'v', from: shortText(o.v), to: shortText(n.v) });
    const op = o.params ?? {}, np = n.params ?? {};
    for (const k of [...new Set([...Object.keys(op), ...Object.keys(np)])].sort()) {
      if (stableJson(op[k]) !== stableJson(np[k])) fields.push({ key: `params.${k}`, from: shortText(op[k]), to: shortText(np[k]) });
    }
    if (fields.length) out.nodes.changed.push({ ...ref(n), fields });
    if ((o.x || 0) !== (n.x || 0) || (o.y || 0) !== (n.y || 0)) out.nodes.moved.push(id);
  }
  for (const [id, n] of old) if (!now.has(id)) out.nodes.removed.push(ref(n));
  out.nodes.added.sort(byId); out.nodes.removed.sort(byId); out.nodes.changed.sort(byId); out.nodes.moved.sort();

  const edgeRefs = (list: readonly DiffEdge[] | undefined) => {
    const m = new Map<string, DiffEdgeRef>();
    for (const e of list ?? []) {
      if (!e) continue;
      const key = edgeKey(String(e.from), e.from_port, String(e.to));
      m.set(key, { key, from: String(e.from), from_port: e.from_port || 'out', to: String(e.to) });
    }
    return m;
  };
  const oe = edgeRefs(before.edges), ne = edgeRefs(b.edges);
  const byKey = (x: DiffEdgeRef, y: DiffEdgeRef) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  out.edges.added = [...ne.values()].filter((e) => !oe.has(e.key)).sort(byKey);
  out.edges.removed = [...oe.values()].filter((e) => !ne.has(e.key)).sort(byKey);

  const og = new Map((before.groups ?? []).map((g) => [g.id, g])), ng = new Map((b.groups ?? []).map((g) => [g.id, g]));
  for (const [id, g] of ng) {
    if (!og.has(id)) out.groups.added.push(id);
    else if (stableJson(og.get(id)) !== stableJson(g)) out.groups.changed.push(id);
  }
  for (const id of og.keys()) if (!ng.has(id)) out.groups.removed.push(id);
  out.groups.added.sort(); out.groups.removed.sort(); out.groups.changed.sort();

  out.total = out.meta.length + out.nodes.added.length + out.nodes.removed.length + out.nodes.changed.length + out.nodes.moved.length
    + out.edges.added.length + out.edges.removed.length + out.groups.added.length + out.groups.removed.length + out.groups.changed.length;
  return out;
}
