import Logger from '@kuraykaraaslan-labs/logger';
import type { ApprovalDecider, ApprovalDecisionGuard, ApprovalDecisionHandler, ApprovalQueueItem } from './approval.types';

/**
 * In-memory hook map: an owning module calls `registerHandler('store_product',
 * fn)` so it is invoked when an item of that `entityType` reaches a terminal
 * decision (e.g. publish the approved product, hard-delete the rejected one).
 *
 * Module-scope on purpose — handlers are wiring, not persisted, and each one
 * closes over its own bundle's DataSource and tenant AsyncLocalStorage, so a
 * process-wide (globalThis) map would run them against the wrong layer's RLS
 * context. The catch: Next compiles `instrumentation.ts` and the route handlers
 * into separate bundles, each with its own copy of this file, so the boot hook
 * only fills the instrumentation copy. `ensureApprovalHandlers()` closes that
 * gap by running the same registrars lazily in whichever copy decides.
 * Invocation is fire-and-forget: a thrown / rejected handler is logged and
 * swallowed so it can never break the decision write.
 */
const DECISION_HANDLERS = new Map<string, ApprovalDecisionHandler>();

let ensured: Promise<void> | null = null;

/**
 * Register every installed owner's handler and guard in THIS module instance, once.
 * The registrar list (`common:boot_task` phase `approval`) is imported lazily so
 * approval never statically depends on the owner modules (they import approval).
 * Re-running a registrar is harmless — each one only `set`s its own entityType —
 * so it does not matter that the boot hook already ran them in its own copy, or
 * in this one (the worker process shares one module graph). One broken
 * registrar is logged inside `registerApprovalHandlers` and the rest still load;
 * if the list itself cannot be imported the memo is cleared so the next decision
 * retries instead of staying unwired for the life of the process.
 */
export function ensureApprovalHandlers(): Promise<void> {
  ensured ??= import('@kuraykaraaslan-labs/common/server/approval-bootstrap')
    .then(({ registerApprovalHandlers }) => registerApprovalHandlers(Logger, 'approval'))
    .catch((err: unknown) => {
      ensured = null;
      Logger.error(`[approval] decision handlers not registered: ${err instanceof Error ? err.message : String(err)}`);
    });
  return ensured;
}

/** Forget that the registrars ran, so a test can exercise the lazy path again. */
export function __resetApprovalHandlersForTests(): void {
  ensured = null;
}

/** Register (or replace) the decision handler for an `entityType`. */
export function registerHandler(entityType: string, handler: ApprovalDecisionHandler): void {
  DECISION_HANDLERS.set(entityType, handler);
}

/** Remove a previously registered handler (mainly for tests / teardown). */
export function unregisterHandler(entityType: string): void {
  DECISION_HANDLERS.delete(entityType);
}

/**
 * Whether an owning module claims this `entityType` (a decision handler or an approve guard is registered for it, after
 * the registrars have run in this copy). Such items are created by their owner's own write path, never through the
 * generic queue route (F.approval.01, fixed 2026-10-20).
 */
export async function isOwnedEntityType(entityType: string): Promise<boolean> {
  await ensureApprovalHandlers();
  return DECISION_HANDLERS.has(entityType) || DECISION_GUARDS.has(entityType);
}

/** Invoke the registered handler for an item's entityType, fire-and-forget (after the registrars have run in this copy). */
export function onDecision(tenantId: string, item: ApprovalQueueItem): void {
  void ensureApprovalHandlers()
    .then(() => {
      const handler = DECISION_HANDLERS.get(item.entityType);
      return handler?.({ tenantId, item });
    })
    .catch((err: unknown) =>
      Logger.error(
        `[approval] decision handler for ${item.entityType} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
}

/**
 * Pre-decision guards: an owner whose APPROVE needs more than a reviewer's click (a co-signed command that is only real once every
 * signature is in) registers one so the queue refuses a bare APPROVE instead of recording a decision the owner cannot honour.
 * A guard runs inside the decision's locked transaction, before anything is written, and refuses by throwing.
 */
const DECISION_GUARDS = new Map<string, ApprovalDecisionGuard>();

export function registerDecisionGuard(entityType: string, guard: ApprovalDecisionGuard): void {
  DECISION_GUARDS.set(entityType, guard);
}

export function unregisterDecisionGuard(entityType: string): void {
  DECISION_GUARDS.delete(entityType);
}

/**
 * Run the guard of an entityType for an APPROVE (the only decision an owner can be unable to honour). No guard, no check, and `toItem` is never called.
 * `decider`: the deciding request, handed to the guard as is (absent for a system flow).
 * `reviewerUserId`: who is approving, so an owner can refuse a self-approval (the item still carries its pre-decision state).
 */
export async function checkApproveGuard(
  tenantId: string, entityType: string, toItem: () => ApprovalQueueItem, decider?: ApprovalDecider, reviewerUserId?: string,
): Promise<void> {
  await ensureApprovalHandlers();
  const guard = DECISION_GUARDS.get(entityType);
  if (guard) await guard({ tenantId, item: toItem(), ...(decider ? { decider } : {}), ...(reviewerUserId ? { reviewerUserId } : {}) });
}
