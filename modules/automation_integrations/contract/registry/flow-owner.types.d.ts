// GENERATED from modules/automation/server/registry/flow-owner.types.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * `automation:flow_owner` (iot-rules 01 §1.3, RL-E10): a module that builds flows from its own records and keeps them. Its flows
 * are deployed with `DeployInternalOptions.owner = { module: key, ref }` and the engine runs them like any other flow, but:
 *  - people cannot change them through the flow API or the editor (draft, deploy, enable/disable, description, delete, restore,
 *    import over one): a 409 `owned_flow` names the owner's `label`; the engine's own operations (a guard's pause, the emergency
 *    stop, a resume, a module's flows switched off when it is disabled) still apply;
 *  - they are left out of `max_flows`: the owner counts them against its own plan key, `limitKey`;
 *  - the editor opens them read-only with `editHint` and a one-way Detach into an ordinary flow, which calls `detach` first.
 *
 * `key` is the contributing module's id (what `automation_flows.ownerModule` stores); one contribution per module. Texts come in
 * the caller's UI language (`locale`, e.g. 'en', 'tr'), with English where the module has none.
 */
export interface FlowOwnerContribution {
    /** The owning module's id. */
    key: string;
    /** The owner's name as a person knows it ("Rules"): the Flows page's badge and the refusal's message. */
    label(locale: string): string;
    /** Where the flow is edited instead ("Edit it in the Rules card"): the editor's banner over a read-only owned flow. */
    editHint(locale: string): string;
    /** The plan key the owner counts its flows against, instead of `max_flows` (e.g. `max_rules`). */
    limitKey: string;
    /**
     * Called by Detach before the flow is turned into an ordinary one (`ownerRef` as the owner stored it): the owner lets go of the
     * record the flow was built from. It runs while the tenant's deploy lock is held, so it must not deploy through automation; a throw
     * refuses the Detach and nothing changes. Absent: the owner keeps nothing to let go of.
     */
    detach?(tenantId: string, flowId: string, ownerRef: string | null): Promise<void>;
}
