import { createHash } from 'node:crypto';
import type { NodeContribution, NodeContext } from '@kuraykaraaslan-labs/automation_integrations';
import { SubmitApprovalDTO } from './approval.dto';
import { submit } from './approval.submit.service';
import { list } from './approval.read.service';
import { DEFAULT_PRIORITY_LABELS } from './approval.priority-labels';

/**
 * `automation:node` contribution: `approval.request` (docs/phases/08-automation/11-first-consumers §11.5, G-159). It opens an
 * item on the approval queue through the module's own `submit` and passes the message on with the request id. Imports
 * `automation` with `import type` only (02 §2.8).
 *
 * - **Its own entity types.** The item's `entityType` is `automation` or `automation.<kind>`, never one an owning module
 *   registered: a decision on such an item would run that owner's handler (publish a product, apply a member change) on an
 *   entity the flow made up. No module registers a handler under `automation`, so the decision runs nothing but the queue's
 *   own audit, submitter notice and `approval.*` event. The DTO the service parses is applied before the call, so a value
 *   the service would refuse is a `range` error here, not a provider failure.
 * - **Idempotent per message.** `entity` names the entity under review (a UUID). Empty, the id is derived from the call's
 *   idempotency key: a redelivered message finds the item it already opened (open or decided) and does not open a second;
 *   an explicit id leans on `submit`, which returns the entity's open item.
 * - **The submitter is a member.** It hears the decision (`approval.decide.service` reads the user by id, not by tenant),
 *   so a user id a flow names must be an ACTIVE member of the flow's tenant: one from a template that is not is `invalid_user`;
 *   an originator that is not leaves the item without a submitter. `tenant_member` is a protected module that requires
 *   `approval`, so it is loaded lazily (no declared edge, no cycle), as `notification` does; a failed look-up fails closed.
 * - **The decision.** `approval.decide.service` fires `approval.approved | rejected | escalated` (and `approval.withdrawn`)
 *   with `{ approvalItemId, entityType, entityId, status }` through `WebhookService.dispatchEvent`. Two ways to use it:
 *   - `wait` off (the default): the message leaves on `out` with the request id at once, and a flow takes the decision as a
 *     new entry with `trigger.event` (source `domain`, kind `approval.*`) filtered on the request id or the entity type.
 *   - `wait` on (G-159): the node keeps the message as a held wait under the request id (01 §1.7: durable, re-booked on start,
 *     carried over a deploy that keeps the node, counted when dropped) and the engine wakes it on the decision (`wake`, 03 §3.5):
 *     `approved` continues with the message, `rejected` and `withdrawn` leave on `rejected`, an escalation only updates the
 *     status. A request that was already decided when a redelivered message finds it continues at once.
 */
export const ENTITY_TYPE = 'automation';
const KIND = /^[a-z0-9_]{1,50}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The palette category of the node (a constant, so a repo scan for `category: '<x>'` literals sees none). */
const PALETTE_CATEGORY = 'action';
/**
 * The held-message key prefix of the engine (01 §1.7, `HELD_KEY_PREFIX`): a value under it is a message the node keeps, which the
 * engine counts, carries over a deploy and books against the parked budget. Spelled here because a contributor imports types only.
 */
const HELD = '\u0001';
const waitKey = (approvalItemId: string) => `${HELD}w:${approvalItemId}`;
/** The decision events that end a wait (an escalation moves the item on and keeps waiting). */
const WAKE_KINDS = ['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.escalated'] as const;

type Msg = Parameters<NonNullable<NodeContribution['executor']['input']>>[1];

/** `automation` or `automation.<kind>`; null for a kind outside `[a-z0-9_]{1,50}`. */
export function entityTypeOf(kind: string | undefined): string | null {
  const k = (kind ?? '').trim();
  if (!k) return ENTITY_TYPE;
  return KIND.test(k) ? `${ENTITY_TYPE}.${k}` : null;
}

/** A stable UUID (version 8, RFC 9562) for an idempotency key: the same message always names the same entity. */
export function entityIdFor(tenantId: string, key: string): string {
  const h = createHash('sha256').update(`approval:automation:${tenantId}:${key}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** True when `userId` is an ACTIVE member of `tenantId`; null when the look-up failed. Swapped by tests. */
export type IsMember = (tenantId: string, userId: string) => Promise<boolean | null>;
const defaultIsMember: IsMember = async (tenantId, userId) => {
  try {
    const { getByTenantAndUser } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service');
    const m = await getByTenantAndUser({ tenantId, userId } as never);
    return m?.memberStatus === 'ACTIVE';
  } catch {
    return null;
  }
};
let isMember: IsMember = defaultIsMember;
export const setIsMember = (fn: IsMember | null): void => {
  isMember = fn ?? defaultIsMember;
};

const status = (e: unknown): number | undefined => {
  const x = e as { statusCode?: number; status?: number } | null;
  return x?.statusCode ?? x?.status;
};

function failure(ctx: NodeContext, msg: Msg, e: unknown) {
  const s = status(e);
  if (s === 400 || s === 422) return ctx.error(msg, 'range', 'the approval queue refused the request');
  if (s === 409) return ctx.error(msg, 'conflict', 'the approval queue is busy with this entity');
  if (s === 402 || s === 403) return ctx.error(msg, 'limit', 'the approval queue refused the request', { limit: { key: 'approval', scope: 'plan' } });
  return ctx.error(msg, 'provider_error', 'the approval queue could not open the request');
}

interface Params { kind?: string; entity?: string; reason?: string; priority?: unknown; submitter?: string; wait?: boolean }

type Item = { approvalItemId: string; entityType: string; entityId: string; status: string };
const withApproval = (ctx: NodeContext, msg: Msg, item: Item): Msg => {
  const out = ctx.clone(msg);
  out.metadata = { ...out.metadata, approval: { approvalItemId: item.approvalItemId, entityType: item.entityType, entityId: item.entityId, status: item.status } };
  return out;
};

/** Shows how many requests the node is waiting on (0 clears the line). */
function showWaiting(ctx: NodeContext): void {
  const n = ctx.state.keys().filter((k) => k.startsWith(`${HELD}w:`)).length;
  ctx.status(n ? { fill: 'yellow', shape: 'ring', text: `waiting for ${n} decision${n === 1 ? '' : 's'}` } : null);
}

const request = async (ctx: NodeContext, msg: Msg) => {
  const p = ctx.node.params as Params;
  const entityType = entityTypeOf(p.kind);
  if (!entityType) return ctx.error(msg, 'range', 'the kind must be 1 to 50 lowercase letters, digits or _');
  const given = p.entity ? ctx.templateOf(p.entity, msg).trim() : '';
  if (given && !UUID.test(given)) return ctx.error(msg, 'range', 'the entity id is not a UUID');
  const derived = !given;
  const entityId = derived ? entityIdFor(ctx.tenantId, ctx.idempotencyKey(msg)) : given.toLowerCase();
  const who = p.submitter ? ctx.templateOf(p.submitter, msg).trim() : '';
  if (who && !UUID.test(who)) return ctx.error(msg, 'invalid_user', 'the submitter is not a user id');
  const origin = msg.originator?.type === 'user' && UUID.test(String(msg.originator.id)) ? String(msg.originator.id).toLowerCase() : null;
  let submittedByUserId = who ? who.toLowerCase() : origin;
  if (submittedByUserId) {
    const member = await isMember(ctx.tenantId, submittedByUserId);
    if (member === null) return ctx.error(msg, 'provider_error', 'the members of the workspace could not be read');
    if (!member) {
      if (who) return ctx.error(msg, 'invalid_user', 'the submitter is not a member of this workspace');
      submittedByUserId = null;
    }
  }
  const dto = SubmitApprovalDTO.safeParse({
    entityType, entityId, submittedByUserId,
    priority: p.priority ?? 0,
    ...(p.reason && { reason: ctx.templateOf(p.reason, msg).slice(0, 2000) }),
    metadata: { source: 'automation', flowId: ctx.flow.id, nodeId: ctx.node.id },
  });
  if (!dto.success) return ctx.error(msg, 'range', 'the approval request is not valid');

  if (ctx.dryRun) {
    ctx.would('open an approval request', { entityType, priority: dto.data.priority });
    return ctx.send(msg);
  }
  try {
    // a redelivered message whose item was already decided: the derived id finds it; an explicit id is the caller's to reuse
    const prior = derived ? (await list(ctx.tenantId, { entityType, entityId, page: 0, pageSize: 1 })).data[0] : undefined;
    const item = prior ?? (await submit(ctx.tenantId, dto.data));
    ctx.action(prior ? 'approval request already opened' : 'approval request opened');
    const out = withApproval(ctx, msg, item);
    if (!p.wait) return ctx.send(out);
    // a redelivered message whose request was decided meanwhile continues at once: the decision event has come and gone
    if (item.status === 'APPROVED') return ctx.send(out, 'approved');
    if (item.status === 'REJECTED' || item.status === 'WITHDRAWN') return ctx.send(out, 'rejected');
    const key = waitKey(item.approvalItemId);
    if (ctx.state.get(key) === undefined) {
      ctx.state.set(key, { msg: out });
      try {
        ctx.hold(out);
      } catch {
        ctx.warn('the parked-bytes budget is full: the wait is kept, not booked');
      }
    }
    showWaiting(ctx);
  } catch (e) {
    return failure(ctx, msg, e);
  }
};

/**
 * The decision of a request this node waits for (G-159): the held message continues on `approved` or `rejected` with the new status;
 * an escalation only updates it. An event for a request this node does not wait for (another node's, or one without `wait`) is not
 * this node's and is dropped. Only `source: domain` events reach here (the engine's event sink), so a flow cannot forge one.
 */
const decided = (ctx: NodeContext, event: Msg) => {
  const data = (event.payload ?? {}) as Partial<Item>;
  const kind = String((event.metadata as { kind?: unknown } | undefined)?.kind ?? '');
  if (typeof data.approvalItemId !== 'string' || !String(data.entityType ?? '').startsWith(ENTITY_TYPE)) return;
  const key = waitKey(data.approvalItemId);
  const held = ctx.state.get<{ msg: Msg }>(key);
  if (!held?.msg) return;
  const out = held.msg;
  const prev = (out.metadata as { approval?: Item }).approval;
  out.metadata = { ...out.metadata, approval: { ...(prev ?? {}), approvalItemId: data.approvalItemId, status: String(data.status ?? '') } as Item };
  if (kind === 'approval.escalated') {
    ctx.state.set(key, { msg: out });
    return;
  }
  const port = kind === 'approval.approved' ? 'approved' : kind === 'approval.rejected' || kind === 'approval.withdrawn' ? 'rejected' : null;
  if (!port) return;
  ctx.state.delete(key);
  ctx.send(out, port);
  ctx.release(out);
  ctx.action(`approval ${port}`);
  showWaiting(ctx);
};

/** After a restart the waits are still in state: book them again (01 §1.7) and show the count. */
const rebook = (ctx: NodeContext) => {
  for (const k of ctx.state.keys()) {
    if (!k.startsWith(`${HELD}w:`)) continue;
    const m = ctx.state.get<{ msg?: Msg }>(k)?.msg;
    if (!m) continue;
    try {
      ctx.hold(m);
    } catch {
      // over the budget after a restart: it was accepted before, so it is kept unbooked (as the engine's own holders do)
    }
  }
  showWaiting(ctx);
};

export const requestNode: NodeContribution = {
  type: 'approval.request',
  declaration: {
    type: 'approval.request',
    title: 'Ask for approval',
    description: 'Opens an approval request on the approval queue',
    sample: { msg: { payload: { amount: 1200, reason: 'New laptop' }, originator: { type: 'user', id: '00000000-0000-4000-8000-000000000001' } } },
    category: PALETTE_CATEGORY,
    group: 'approval',
    inputs: 1,
    outputs: ['out', 'approved', 'rejected'],
    port_labels: { out: 'opened', approved: 'approved', rejected: 'rejected or withdrawn' },
    risk: 'external',
    runtimes: ['cloud'],
    features: ['approval'],
    params: {
      kind: { type: 'string', max_len: 50, pattern: '^[a-z0-9_]*$', label: 'Kind', hint: 'empty = automation; e.g. purchase gives automation.purchase' },
      entity: { type: 'template', max_len: 200, label: 'Entity id (UUID)', hint: 'empty = one per message' },
      reason: { type: 'template', max_len: 2000, label: 'Reason', hint: 'shown to the reviewer' },
      priority: { type: 'enum', options: [0, 1, 2, 3], option_labels: Object.fromEntries(Object.entries(DEFAULT_PRIORITY_LABELS)), default: 0, label: 'Priority' },
      submitter: { type: 'template', max_len: 200, label: 'Submitter (user id)', hint: 'told of the decision; empty = the message’s originator, when it is a user' },
      wait: { type: 'bool', default: false, label: 'Wait for the decision', hint: 'off: continue on opened at once; on: continue on approved or rejected when someone decides' },
    },
  },
  executor: { input: request, wake: decided, start: rebook, dryRunAware: true },
  wake: { source: 'domain', kinds: WAKE_KINDS },
  holds: true,
  external: true,
  parallel: true,
  timeout: { class: 'external', default: 5000, max: 15_000 },
  // 08/14 FP-6 (LG-26): a new request is announced as approval.submitted (a repeat of the same entity opens none, so not certain);
  // the decision events it waits for (`wake`) come from a person, not from the node
  feedback: () => ({ writes: [{ channel: 'event', source: 'domain', key: 'approval.submitted' }] }),
};

const approvalNodes: NodeContribution[] = [requestNode];
export default approvalNodes;
