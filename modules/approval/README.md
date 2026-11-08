# Approval Queue Module

Generic, entity-agnostic moderation / approval queue. Any owning module can route one of its entities through human review by submitting to the queue keyed by `(entityType, entityId)`; a reviewer then claims and decides (approve / reject / escalate). Every submission is written to a tamper-evident per-tenant hash chain, every decision is recorded in the append-only audit log, submitters are notified in-app, and webhooks fire on each lifecycle event. The queue never interprets `entityType` — the owning module reacts to terminal decisions via an in-memory handler hook.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `ApprovalQueueItem` | `approval_queue_items` | One review item, keyed by `(entityType, entityId)`. Holds status, priority, submit/decision metadata, SLA due date, and the hash-chain columns (`prevHash` / `rowHash`). |
| `ApprovalChainStep` | `approval_chain_steps` | One step of a multi-step chain (migration 173), keyed by `(entityType, entityId, purpose, stepIndex)`: level, named approver or permission, status, the queue item it became. See **Multi-step chains**. |

Lives in the **tenant DB** (resolved per request via `tenantDataSourceFor(tenantId)`); every row is isolated by `tenantId`.

Indexes:
- `idx_approval_tenant_status` — `(tenantId, status)`, queue filtering.
- `idx_approval_tenant_entity` — `(tenantId, entityType, entityId)`.
- `uq_approval_open_entity` — **partial unique** on `(tenantId, entityType, entityId)` `WHERE status NOT IN ('APPROVED','REJECTED')`, so an entity can have at most one open item but can be re-submitted after a terminal decision.

---

## Lifecycle

Open states: `PENDING`, `IN_REVIEW`, `ESCALATED`. Terminal states: `APPROVED`, `REJECTED`, `WITHDRAWN`.

| Decision | From | To | Terminal |
|---|---|---|---|
| `APPROVE` | `PENDING` / `IN_REVIEW` / `ESCALATED` | `APPROVED` | yes |
| `REJECT` | `PENDING` / `IN_REVIEW` / `ESCALATED` | `REJECTED` | yes |
| `ESCALATE` | `PENDING` / `IN_REVIEW` (not already `ESCALATED`) | `ESCALATED` | no |
| `withdrawForEntity` (the owning module, not a reviewer) | any open state | `WITHDRAWN` | yes |

**WITHDRAWN (migration 163).** When the owning module settles an entity
another way (a leave decided on its own page, a correction withdrawn by its
requester, a deleted request), it calls `withdrawForEntity`.

- **Why:** the item used to stay PENDING forever. It sat in every reviewer's
  inbox, and deciding it later was a silent no-op.
- **What it skips:** it is not a reviewer decision. It does not call the
  owner's handler (the owner is the caller, so calling back would loop), it
  does not notify the submitter (the owner does that), and the SLA and
  workload reports do not count it.
- **Idempotent:** it returns null when nothing is open. It is therefore safe
  on the path the queue's own decision triggered.
- **The one-open index** treats WITHDRAWN as terminal, so the entity can be
  submitted again.
- **Callers today:** `hr_leave` (approve, reject, withdraw, expire, delete) and
  `hr_attendance` corrections (direct decide, withdraw).

`claim` moves `PENDING → IN_REVIEW` (rejected with `409` from any other state). Already-terminal items are immutable — a further decision returns `409` (`ALREADY_DECIDED`). Submit is **idempotent**: if an open item already exists for the entity it is returned unchanged (the partial unique index also catches the create race, which is re-read rather than surfaced as an error).

---

## Service (`ApprovalQueueService`)

Facade over focused implementation modules (`approval.read.service`, `.submit.service`, `.decide.service`, `.chain`, `.handlers`, `.report.service`). All methods are static and take `tenantId` first.

| Method | Responsibility |
|---|---|
| `submit(tenantId, dto)` | Idempotent submit: returns the existing open item or creates a `PENDING` one, computes `slaDueAt`, appends to the hash chain, dispatches `approval.submitted`. |
| `list(tenantId, query)` | Paginated queue list, filterable by `status` / `entityType` / `entityId` / `reviewedByUserId` / `priority`, ordered most-urgent-then-oldest (`priority DESC, createdAt ASC`). Returns `{ data, total }`. |
| `get(tenantId, approvalItemId)` | Single item (`404` if not found). |
| `claim(tenantId, reviewerUserId, approvalItemId)` | `PENDING → IN_REVIEW`, records the reviewer (pessimistic write lock). |
| `decide(tenantId, reviewerUserId, approvalItemId, dto)` | Records approve / reject / escalate: guards the transition, writes the audit log, invokes the registered handler (terminal only), notifies the submitter, dispatches the matching webhook. |
| `withdrawForEntity(tenantId, entityType, entityId, { actorId?, reason? })` | The owning module closes the entity's open item as `WITHDRAWN` (locked; no handler, no submitter notice; `approval.withdrawn` webhook + audit). Idempotent — `null` when none is open. |
| `verifyChain(tenantId)` | Re-derives the per-tenant hash chain and returns `{ ok, checked, brokenAt }`. |
| `getReport(tenantId, { from?, to? })` | Period-based analytics (delegates to `ApprovalReportService`). |
| `registerHandler(entityType, handler)` / `unregisterHandler(entityType)` | Register / remove the in-memory terminal-decision hook for an `entityType`. |

The submit / claim / decide writes run in a per-tenant transaction; claim and decide take a `pessimistic_write` lock on the row.

---

## Decision Handler Hook

`ApprovalQueueService.registerHandler('store_product', fn)` lets the owning module react when an item of that `entityType` reaches a **terminal** decision (e.g. publish the approved product, hard-delete the rejected one). The handler receives `{ tenantId, item }`.

The registry (`approval.handlers.ts`) is an in-process `Map`, module-scoped and not persisted — wiring is registered at boot in the same process. Invocation is fire-and-forget: a thrown or rejected handler is logged and swallowed so it can never break the decision write. `ESCALATE` (non-terminal) does not invoke the handler.

Tenant settings are the one owner approval wires itself, because approval requires tenant_setting and the import may only
go that way: approval contributes the reviewer of `tenant_setting:change_review` (`approval.setting-change-reviewer.ts`,
items of entityType `tenant_setting_change`) and its own approval-phase boot task (`approval.setting-change.ts`)
registers the decision handler, which calls tenant_setting's `applySettingChangeDecision`.
`tenant_setting_change` is reserved: `POST /approvals` refuses it (403), so only the settings write path parks a setting
change (review 2026-10-18). The same boot task registers the `tenant_setting_change` APPROVE guard, tenant_setting's
`assertSettingChangeApprovable`: a parked IP list change is checked against the APPROVER's request (its trusted client IP
and `ipListsExempt`), so one that would lock the approver out is refused 409 and stays pending.


### Decision guards and decision steps

Some owners cannot honour a bare APPROVE: a class-3 fleet command is only real once every operator has co-signed it with a security key. Two additions let such an owner keep the queue honest.

- **`ApprovalQueueService.registerDecisionGuard(entityType, guard)`.** The guard runs inside the locked decision transaction, before anything is written, for an APPROVE only (REJECT and ESCALATE never consult it). It refuses by throwing (an `AppError`, usually `409`). Without a guard for the `entityType` nothing changes. Like handlers, guards are in-process wiring registered at boot. The guard also receives `decider` (`ApprovalDecider`: the deciding `request` and its `ipListsExempt`) when a reviewer decides through `PATCH /approvals/[approvalItemId]` or the step decide route (`decide(…, decider)`); a system flow passes none.
- **`metadata.decisionStep` on the item** (any string; fleet uses `fleet.cosign`). The queue pages withhold their own Approve button for such items (the list dialog offers "Open to decide" instead) and the item page renders the client slot `approval.item.decision` (extension point `approval:item_decision`, props `{ tenantId, item, onChanged }`) where the owner contributes its own decision step. A contribution renders nothing for an entityType that is not its own. Reject and Escalate stay available.

The owner's step then makes the real decision through its own API and settles the queue item itself (`ApprovalQueueService.decide`), which the guard allows because the owner's state is by then in order. First consumer: `fleet` (`fleet.approval.handler.ts`).

---

## Multi-step chains (`ApprovalChainService`, migration 173)

A chain is an ordered list of steps on one entity, e.g. a leave request that
the employee's manager and then HR must approve. It is the polymorphic
primitive the 2026-09-11 alignment note moved here from hr_leave's planned
`leave_approval_steps` (four consumers: hr_leave, expense, hr_recruitment,
procurement).

- **The owner defines the steps; `approval` runs them.**
  `ApprovalChainService.start(tenantId, { entityType, entityId, purpose, steps })`,
  where a step is `{ level, approverUserId? , approverPermission? }`. The first
  step is PENDING, the rest WAITING. Starting again while a chain is open
  returns the open chain.
- **The active step is an ordinary queue item** (`entityType:
  'approval_chain_step'`, entityId = the step). It is listed, audited and
  hash-chained like any other item; `approval_queue_items` is not changed, so
  the hash chain is untouched. The item carries no submitter: the queue
  notifies an item's submitter of every decision, and an intermediate step is
  not the outcome.
- **Decisions advance the chain.** APPROVED: the next step is queued, or the
  owner's `onComplete` hears APPROVED. REJECTED: the rest are SKIPPED and the
  owner hears REJECTED. Only a PENDING step moves, so a redelivered decision
  is a no-op.
- **Who decides a step**: `POST /approvals/steps/[stepId]/decide` admits the
  named approver, a caller holding the step's `approverPermission`, or a queue
  reviewer (`approval.approvals.decide`). The chain's submitter never decides
  their own. A queue reviewer can also decide the item from `/admin/approvals`.
- **The owner settling the entity another way** calls `cancel`: open steps
  become CANCELLED and the active item WITHDRAWN.
- **Owners register** with `ApprovalChainService.registerOwner(entityType,
  { onComplete, onStepActivated? })` at boot, like `registerHandler`.
  `onStepActivated` is where an owner notifies a named approver.

`/admin/approvals/my-steps` (**My approvals**, `approval.steps.decide`,
minRole USER) lists the steps waiting on the caller by name: a manager who is
not a tenant admin approves their reports' leave there.

First consumer: `hr_leave` (`leave_types.approvalChain`).

---

## Hash Chain (tamper evidence)

Each item is linked into a per-tenant append-only chain, mirroring the `audit_log` / `wallet` hashing scheme: `rowHash = sha256(prevHash + canonical(row))`, where `prevHash` is the previous item's `rowHash` for the same tenant (`null` for the first row). The chain is computed once at insert (`chainOnInsert`, inside the submit transaction). A per-tenant `pg_advisory_xact_lock` serialises the link step, and the head is the chain's **tip**: the linked row whose `rowHash` no row names as `prevHash`, not simply the latest `createdAt`. Before 2026-09-25, two concurrent submits both linked to the same head, and a same-millisecond tie could link to a row that already had a successor. Either one forked the chain, so `verifyChain` reported tampering that never happened.

Only **immutable insert-time content** is hashed — `approvalItemId`, `tenantId`, `entityType`, `entityId`, `submittedByUserId`, `priority`, `reason`, `createdAt`. Later claim / decide mutations (and `slaDueAt`, which is recomputable from tenant settings) are deliberately **not** hashed, so they never invalidate the chain. The append-only decision trail itself is the `audit_log`, written on every decision. `verifyChain` **walks** the `prevHash` → `rowHash` links from the genesis row (not a `createdAt` sort), re-derives each hash, and reports the first broken row, a fork, or a row not on the chain.

---

## API Routes

All routes are tenant-scoped under `/tenant/[tenantId]/api/approvals`, require tenant role `ADMIN` (via `TenantSessionNextService.authenticateTenantByRequest`), and are rate-limited (`Limiter`).

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/approvals` | `ADMIN` | List queue items (`page`, `pageSize`, `status`, `entityType`, `entityId`, `reviewedByUserId`, `priority`). |
| POST | `/approvals` | `ADMIN` | Submit an entity to the queue (`201`; idempotent per open entity; `submittedByUserId` defaults to the caller; `403` for the reserved `tenant_setting_change` type). |
| GET | `/approvals/[approvalItemId]` | `ADMIN` | Fetch a single item (`404` if not found). |
| PATCH | `/approvals/[approvalItemId]` | `ADMIN` | Claim or decide. Body `{ action: 'claim' }` or `{ action: 'decide', decision, note? }`. |
| GET | `/approvals/reports` | `ADMIN` | Period analytics (`from`, `to`). |
| GET | `/approvals/verify-chain` | `ADMIN` | Re-derive the decision hash chain → `{ ok, checked, brokenAt }`. |
| GET | `/approvals/steps/mine` | `approval.steps.decide` (USER) | Chain steps waiting on the caller by name. |
| POST | `/approvals/steps/[stepId]/decide` | `approval.steps.decide` (USER) | `{ decision: 'APPROVE' \| 'REJECT', note? }`; the service checks the caller may decide this step. |

---

## Admin Pages

Tenant-scoped under `/tenant/[tenantId]/admin`, registered in the **Operations** workspace.

- `/admin/approvals` — the review queue: status filter, server-side table, claim / decide actions.
- `/admin/approvals/[approvalItemId]` — item detail: entity link, priority / SLA, decision form, and chain verification.
- `/admin/approvals/reports` — analytics dashboard (stat cards + date-range picker) over the report payload.
- `/admin/approvals/my-steps` — **My approvals**: chain steps assigned to the caller by name, approve / reject.
- `/admin/approvals/settings` — per-tenant SLA targets and priority-bucket labels (rendered from `APPROVAL_SETTINGS_FIELDS` via the shared `ModuleSettingsPage`).

---

## Reports (`ApprovalReportService.getReport`)

Aggregates `approval_queue_items` rows whose `createdAt` falls in `[from, to]` (default: month-to-date). Live rows are used — not the audit log — because SLA compliance needs both submit time (`createdAt` / `slaDueAt`) and decision time (`reviewedAt`). Returns:

- `slaCompliance` — decided / onTime / breached counts + `compliancePct` (a decided item is on-time when `reviewedAt <= slaDueAt`).
- `workload` — per reviewer: decided count and average resolution hours.
- `entityTypes` — per `entityType`: submitted / decided / approved / rejected.
- `trend` — per calendar day: submitted vs decided.

---

## SLA

`slaDueAt = createdAt + hours[priority]`. Priority is an integer `0..3` (higher = more urgent). Default hours-to-first-resolution by bucket:

| Priority | Bucket | Default hours |
|---|---|---|
| 0 | Routine | 72 |
| 1 | Elevated | 48 |
| 2 | High | 24 |
| 3 | Urgent | 8 |

Unmapped priorities fall back to `APPROVAL_DEFAULT_SLA_HOURS` (72). Each bucket's hours can be overridden per tenant (see *Configuration*). Because `slaDueAt` is not part of the hash chain, resolving it from tenant settings is chain-safe.

---

## Webhooks

Dispatched via `WebhookService.dispatchEvent(tenantId, …)`, fire-and-forget:

| Event | When | Payload |
|---|---|---|
| `approval.submitted` | New item created (not on idempotent re-submit) | `approvalItemId`, `entityType`, `entityId`, `priority` |
| `approval.approved` | `APPROVE` decision | `approvalItemId`, `entityType`, `entityId`, `status`, `reviewedByUserId` |
| `approval.rejected` | `REJECT` decision | same shape as approved |
| `approval.escalated` | `ESCALATE` decision | same shape as approved |
| `approval.withdrawn` | `withdrawForEntity` closed an open item | `approvalItemId`, `entityType`, `entityId`, `status` |

Every decision also writes an `audit_log` row (`action = approval.<approve\|reject\|escalate>`, `resourceType = entityType`, `resourceId = entityId`, metadata incl. `rowHash`), and — when `submittedByUserId` is known — pushes an in-app notification (`type: 'approval'`) to the submitter.

---

## Configuration

Per-tenant setting keys (declared as `APPROVAL_KEYS` in `module.json`; read via `SettingService`). SLA-hour reads are best-effort — a failed read or empty value falls back to the hardcoded defaults.

| Key | Group | Default | Purpose |
|---|---|---|---|
| `approvalSlaHoursRoutine` | SLA | `72` | SLA hours for priority 0. |
| `approvalSlaHoursElevated` | SLA | `48` | SLA hours for priority 1. |
| `approvalSlaHoursHigh` | SLA | `24` | SLA hours for priority 2. |
| `approvalSlaHoursUrgent` | SLA | `8` | SLA hours for priority 3. |
| `approvalBucketLabelRoutine` | Priority labels | `Routine` | UI label for priority 0. |
| `approvalBucketLabelElevated` | Priority labels | `Elevated` | UI label for priority 1. |
| `approvalBucketLabelHigh` | Priority labels | `High` | UI label for priority 2. |
| `approvalBucketLabelUrgent` | Priority labels | `Urgent` | UI label for priority 3. |

The bucket labels were not read before 2026-09-25: the queue showed a bare number and the detail page a hard-coded English name. `GET /approvals` and `GET /approvals/{id}` now return `priorityLabels` (`approval.priority-labels.ts`), where a saved non-blank label replaces the built-in name. The queue's priority column and the detail page use it.

---

## Tenant Variability

All queue data lives in the tenant DB and is isolated by `tenantId` via the per-tenant DataSource; the hash chain is per tenant (`prevHash` links only rows of the same tenant). The eight setting keys above are per-tenant: the SLA-hour keys change the computed `slaDueAt` for that tenant's new items, and the bucket-label keys rename priority buckets in that tenant's admin UI. Every other behavior (statuses, transitions, hashing, webhook events) is identical across tenants.

---

## Dependencies

Requires (`module.json`): `db`, `env`, `logger`, `common`, `webhook`, `audit_log`, `notification_inapp`, `setting`. At runtime the routes also use `limiter` (rate limiting) and `tenant_session` (admin auth).
