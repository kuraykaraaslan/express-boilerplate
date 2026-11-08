// The `ai_agent:action` contract. Lives in `common` so that a domain module (CRM, ...) can register an action without depending on
// `ai_agent` (an Enterprise module). `ai_agent` re-exports these from its old path; contributors import from here.

/**
 * The `ai_agent:action` contract — what a domain module registers when it wants
 * one of its records to be drivable by an agent.
 *
 * ## The decision-maker writes nothing
 *
 * `plan()` proposes; `execute()` writes — and `execute()` is the CONTRIBUTOR's
 * own code, running inside the module that owns the record. `ai_agent` never
 * touches `crm_leads`. This is `crm_assignment`'s rule ("the decision-maker
 * writes nothing, the owning module performs its own write") carried over
 * deliberately: an agent module that wrote into other domains' tables would be
 * a second writer for every record it can reach, and the first schema change in
 * any of them would break it silently.
 *
 * ## Why `plan` may answer null
 *
 * "Nothing to propose here" is the common case — most records, most sweeps. It
 * is not an error and must not cost a run row, an approval or a log line at
 * error level; a runtime that treated silence as failure would drown the tenant
 * in noise on its first day.
 *
 * ## `confidence` is observed, not obeyed
 *
 * It is recorded on the run and shown to whoever reviews it. Nothing in this
 * module gates on it, because a threshold is a policy decision and the
 * contributor is a better judge of what its own numbers mean.
 *
 * ## `autoApprovable` is the contributor's own consent to AUTO mode
 *
 * A tenant can only put an action in `AUTO` (write with no human in the loop)
 * if the module that owns the record has said the action is safe for it —
 * `autoApprovable: true`. The three that ship set it because their authors
 * built them for it: two file a note and send nothing, one flips a lifecycle
 * status on an untouched record through the same guarded service a person
 * would use. An action that CANNOT be undone cheaply leaves it unset, and a
 * tenant's AUTO request for it is refused (`upsert`, and the sweep downgrades
 * to SUGGEST as a backstop).
 */
export interface AiAgentAction {
  /** Stable id: `<module>.<verb>`, e.g. `crm_lead.auto_qualify`. */
  actionType: string
  /** The record population it acts on: `crm_lead.Lead`. Polymorphic, no FK. */
  subjectType: string
  /** What an admin sees in the settings list. */
  label: string
  /** Longer explanation for the settings screen. Optional. */
  description?: string
  /**
   * May a tenant run this without a human approving each decision (`AUTO`)?
   * Default `false` — the safe answer for a socket. Set only where the write is
   * cheap to undo and the contributor has decided it is fit for automation.
   */
  autoApprovable?: boolean

  /**
   * The records worth looking at, most-deserving first.
   *
   * The contributor decides what "a candidate" means for its own domain — an
   * unqualified lead, a stale opportunity — because only it knows. The runtime
   * imposes one thing: a HARD limit per sweep, which it passes in. An agent
   * that asked for everything would put one LLM call per record on a tenant's
   * bill the first time somebody switched it on.
   */
  listCandidates(tenantId: string, limit: number): Promise<string[]>

  /**
   * Look at one record and propose a change — or answer null for "nothing to
   * say about this one".
   */
  plan(
    tenantId: string,
    subjectId: string,
  ): Promise<AiAgentProposal | null>

  /**
   * Apply a proposal the runtime decided to carry out. Runs in the contributing
   * module, against its own records.
   *
   * Given the FROZEN proposal from the run row rather than re-planned: a
   * proposal a human approved on Tuesday must be the one that lands, not
   * whatever the model would say today.
   */
  execute(
    tenantId: string,
    subjectId: string,
    proposedChange: Record<string, unknown>,
  ): Promise<void>
}

export interface AiAgentProposal {
  /** One sentence a human can act on, in their own language where possible. */
  summary: string
  /** The change itself, in the contributor's own vocabulary. */
  proposedChange: Record<string, unknown>
  /** 0–1. Recorded and displayed; nothing gates on it — see above. */
  confidence: number
}

/** How an enabled action behaves when it has something to propose. */
export type AiAgentMode = 'SUGGEST' | 'AUTO'

/** Why a run ended the way it did. */
export type AiAgentRunOutcome =
  | 'EXECUTED'          // the change was applied
  | 'SUGGESTED'         // a human was asked
  | 'SKIPPED_CAP'       // the tenant's daily allowance was spent
  | 'SKIPPED_DISABLED'  // the action is off for this tenant, or the kill switch is
  | 'ERROR'             // the contributor threw
