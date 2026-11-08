// GENERATED from modules/automation/server/registry/choices.types.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
export interface ChoiceItem {
    value: string | number | boolean | null;
    label: string;
}
export interface ListQuery {
    q?: string;
    limit?: number;
    cursor?: string;
}
export interface ListPage {
    items: ChoiceItem[];
    next?: string;
}
export interface ChoicesContribution {
    name: string;
    list(tenantId: string, query: ListQuery): Promise<ListPage>;
    resolve?(tenantId: string, ids: string[]): Promise<Record<string, string>>;
    byName?(tenantId: string, names: string[]): Promise<Record<string, string>>;
    /** The originator `type` this list's ids name (`device`, `crm_lead`). */
    entityType?: string;
    /** Per-type owner lookup: the user ids that own an entity (`action.notify`'s `originator_owner`). Needs `entityType`. */
    ownerOf?(tenantId: string, id: string): Promise<string[]>;
    requiredPermission?: string;
}
/** Why a list could not be served: no permission, or no such list / a provider that failed (the field shows "list unavailable"). */
export type ChoiceError = 'unavailable' | 'forbidden';
export type ChoiceResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: ChoiceError;
};
/** A contribution that was refused at register, for the contributions check. */
export interface SkippedChoice {
    module: string;
    name: string;
    problems: string[];
}
