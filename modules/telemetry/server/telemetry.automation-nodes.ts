// Shapes only: `automation` is Enterprise and this module is Core, so the node is typed against the Core contract package
// (`automation_integrations`, SEAM-2) and never imports the engine. The contribution loads only where `automation` is installed.
import type { NodeContext, NodeContribution, NodeDeclaration } from '@kuraykaraaslan-labs/automation_integrations';
import type { TelemetryValue, TelemetryWriteRow, TelemetryWriter } from './telemetry.contract';
import { getTelemetryWriter } from './telemetry.writer';
import { isConnectionError } from './telemetry.errors';
import { ensureTelemetryKindsLoaded, telemetryKindOf, type TelemetryEntityKind } from './telemetry.kinds';

type FlowMsg = Parameters<NodeContext['error']>[0];

/**
 * `action.save_reading` (docs/phases/42-telemetry/02 §2.4): a flow on the generic host stores `msg.payload`'s key/value pairs as a
 * reading of an entity of a kind that accepts external writes (`acceptsExternalWrites`; the kind's `canWrite` may narrow it to some
 * entities). One `TelemetryWriter.write` per wave of the node's queued messages (`Executor.batch`), like the IoT save node; a row the
 * store refuses leaves through `error` with its code; a connection failure abandons the run (the engine pauses). Not on the IoT host:
 * device data is the IoT node's, and bound readings leave the IoT worker another way (ED-13).
 */
const PALETTE_GROUP = 'telemetry';
export const SAVE_READING_WAVE = 500;
export const SAVE_READING_WAVES = 4;

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveOutcome = { ok: true } | { ok: false; code: string; text: string };
interface Waiting { row: TelemetryWriteRow; resolve: (o: SaveOutcome) => void; reject: (e: unknown) => void }

/** The wave collector: one writer call per tenant, flow, node and kind once the wave has arrived or the event loop turns. */
export class ReadingWaves {
  private readonly waves = new Map<string, { tenantId: string; kind: string; items: Waiting[] }>();
  constructor(private readonly writer: () => TelemetryWriter) {}

  save(ctx: Pick<NodeContext, 'tenantId' | 'flow' | 'node' | 'wave'>, kind: string, row: TelemetryWriteRow): Promise<SaveOutcome> {
    const key = `${ctx.tenantId}\u0000${ctx.flow.id}\u0000${ctx.node.id}\u0000${kind}`;
    return new Promise<SaveOutcome>((resolve, reject) => {
      let w = this.waves.get(key);
      if (!w) {
        w = { tenantId: ctx.tenantId, kind, items: [] };
        this.waves.set(key, w);
        setImmediate(() => void this.flush(key, w!));
      }
      w.items.push({ row, resolve, reject });
      if (w.items.length >= Math.max(1, ctx.wave)) void this.flush(key, w);
    });
  }

  private async flush(key: string, w: { tenantId: string; kind: string; items: Waiting[] }): Promise<void> {
    if (this.waves.get(key) === w) this.waves.delete(key);
    const items = w.items.splice(0);
    if (!items.length) return;
    try {
      const r = await this.writer().write(w.tenantId, w.kind, items.map((i) => i.row));
      const failed = new Map(r.errors.map((e) => [e.index, e.reason]));
      items.forEach((it, i) => {
        const reason = failed.get(i);
        if (reason === undefined) return it.resolve({ ok: true });
        const code = reason.startsWith('save_failed') ? 'save_failed' : reason.split(':')[0];
        it.resolve({ ok: false, code, text: reason });
      });
    } catch (e) {
      for (const it of items) it.reject(e);
    }
  }
}

const waves = new ReadingWaves(() => getTelemetryWriter());
const writable = new Map<string, { at: number; ok: boolean }>();
const WRITABLE_TTL_MS = 60_000;

/** The kind, when it exists and takes external writes for this entity and actor (cached a minute per tenant, kind, entity, actor). */
export async function writableKind(ctx: Pick<NodeContext, 'tenantId' | 'actor' | 'clock'>, kind: string, entityId: string, lookup: (k: string) => TelemetryEntityKind | undefined = telemetryKindOf): Promise<TelemetryEntityKind | { refused: string }> {
  let k = lookup(kind);
  if (!k) {
    await ensureTelemetryKindsLoaded();
    k = lookup(kind);
  }
  if (!k) return { refused: 'unknown_kind' };
  if (k.acceptsExternalWrites !== true) return { refused: 'kind_not_writable' };
  if (!k.canWrite) return k;
  const key = `${ctx.tenantId}\u0000${kind}\u0000${entityId}\u0000${ctx.actor}`;
  const hit = writable.get(key);
  const now = ctx.clock.now();
  if (hit && now - hit.at < WRITABLE_TTL_MS) return hit.ok ? k : { refused: 'entity_not_writable' };
  const ok = (await k.canWrite({ tenantId: ctx.tenantId, actor: ctx.actor }, [entityId])).has(entityId);
  writable.set(key, { at: now, ok });
  if (writable.size > 50_000) writable.delete(writable.keys().next().value as string);
  return ok ? k : { refused: 'entity_not_writable' };
}

function recordTimeOf(ctx: NodeContext, msg: FlowMsg, p: { ts?: string; ts_path?: string }): number | { bad: string } {
  const m = (msg.metadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (p.ts === 'receive') return num(m.ts) ?? ctx.clock.now();
  if (typeof p.ts_path === 'string' && p.ts_path.trim() !== '') {
    let v: unknown;
    try { v = ctx.exprOf(p.ts_path, msg); } catch { v = undefined; }
    if (v !== undefined && v !== null) {
      const n = typeof v === 'string' && /^\d{1,16}$/.test(v.trim()) ? Number(v.trim()) : v;
      if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) return n;
      return { bad: `the value at ${p.ts_path} is not a time in epoch milliseconds` };
    }
  }
  return num(m.recordTs) ?? num(m.ts) ?? ctx.clock.now();
}

function entityOf(ctx: NodeContext, msg: FlowMsg, p: { entity_path?: string }): string | null {
  if (typeof p.entity_path === 'string' && p.entity_path.trim() !== '') {
    try {
      const v = ctx.exprOf(p.entity_path, msg);
      return typeof v === 'string' && UUID.test(v) ? v : null;
    } catch {
      return null;
    }
  }
  const id = (msg as { originator?: { id?: unknown } }).originator?.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

export const saveReading = async (ctx: NodeContext, msg: FlowMsg): Promise<void> => {
  const p = ctx.node.params as { kind?: string; entity_path?: string; ts?: string; ts_path?: string; keys?: unknown };
  const kind = typeof p.kind === 'string' ? p.kind.trim() : '';
  if (!kind) return ctx.error(msg, 'invalid_value', 'the node names no kind');
  if (!isPlainObject(msg.payload)) return ctx.error(msg, 'invalid_value', 'msg.payload is not an object of key/value pairs');
  const entityId = entityOf(ctx, msg, p);
  if (!entityId) return ctx.error(msg, 'invalid_entity', 'no entity id: name entity_path or give the message an originator with a uuid');
  const k = await writableKind(ctx, kind, entityId);
  if ('refused' in k) return ctx.error(msg, k.refused, `kind ${kind} does not take this write (${k.refused})`);
  const ts = recordTimeOf(ctx, msg, p);
  if (typeof ts !== 'number') return ctx.error(msg, 'bad_ts', ts.bad);
  const only = Array.isArray(p.keys) ? p.keys.filter((x): x is string => typeof x === 'string' && x !== '') : [];
  const values = (only.length ? Object.fromEntries(Object.entries(msg.payload).filter(([key]) => only.includes(key))) : msg.payload) as Record<string, TelemetryValue>;
  const dry = (ctx as unknown as { dryRun?: boolean; would?: (what: string, details: unknown) => void });
  if (dry.dryRun) {
    dry.would?.('save reading', { kind, entityId, keys: Object.keys(values).length, ts });
    return ctx.send(msg);
  }
  try {
    const outcome = await waves.save(ctx, kind, { entityId, ts, values });
    if (!outcome.ok) return ctx.error(msg, outcome.code, outcome.text, { ts });
    ctx.send(msg);
  } catch (e) {
    if (isConnectionError(e)) throw e;
    ctx.error(msg, 'save_failed', e instanceof Error ? e.message : String(e), { ts });
  }
};

const saveReadingDeclaration: NodeDeclaration = {
  type: 'action.save_reading',
  title: 'Save reading',
  description: 'Stores the message’s key/value pairs as a reading of an entity of a telemetry kind that accepts flow writes',
  category: 'action',
  group: PALETTE_GROUP,
  icon: 'wave-square',
  inputs: 1,
  outputs: ['out'],
  risk: 'low',
  runtimes: ['cloud'],
  mutates: true,
  params: {
    kind: { type: 'string', max_len: 64, label: 'Kind', hint: 'a telemetry kind that accepts flow writes (asset, warehouse.location, …)' },
    entity_path: { type: 'path', label: 'Entity id from', hint: 'optional: a uuid here is the entity; otherwise msg.originator.id' },
    ts: { type: 'enum', options: ['device', 'receive'], option_labels: { device: 'record time', receive: 'receive time' }, default: 'device', label: 'Time' },
    ts_path: { type: 'path', label: 'Time from', hint: 'optional: a value here (epoch ms, a number or a numeric string) re-times the reading', when: { param: 'ts', value: 'device' } },
    keys: { type: 'list', items: { type: 'string', max_len: 64 }, default: [], label: 'Keys', hint: 'none = every key of msg.payload' },
  },
  sample: { msg: { payload: { running_hours: 1204.5 }, originator: { type: 'asset', id: '00000000-0000-4000-8000-0000000000a1' }, metadata: { ts: 1_761_300_000_000 } } },
} as NodeDeclaration;

export const saveReadingNode: NodeContribution = {
  type: 'action.save_reading',
  declaration: saveReadingDeclaration,
  executor: { input: saveReading, dryRunAware: true, batch: SAVE_READING_WAVE, waves: SAVE_READING_WAVES },
  hosts: ['generic'],
  breaker: 'off',
} as NodeContribution;

const telemetryNodes: NodeContribution[] = [saveReadingNode];
export default telemetryNodes;
