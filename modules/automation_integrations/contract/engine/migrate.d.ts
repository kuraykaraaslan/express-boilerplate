// GENERATED from modules/automation/server/engine/migrate.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/** Phase 01 §1.3 step 1 / 02 §2.4: the router's versioning contract (`RT-mig`), plus the cloud's no-reset rule. */
export declare const CONTRACT = "1.0";
export type ContractResult = {
    ok: true;
} | {
    ok: false;
    code: 'newer_contract' | 'bad_contract';
};
/** A missing contract means "1.0"; a later minor is accepted, a later major refused, a malformed value refused. */
export declare function contractCheck(value: unknown): ContractResult;
export type Params = Record<string, unknown>;
/** The part of a node contribution migration needs (02 §2.2). */
export interface MigrationSource {
    /** The declaration's params version, default 1. */
    version?: number;
    /** `v → v + 1`, pure. */
    migrations?: Readonly<Record<number, (params: Params) => Params>>;
}
export type MigrateResult = {
    ok: true;
    v: number;
    params: Params;
    migrated: boolean;
} | {
    ok: false;
    code: 'newer_block' | 'migration_failed';
    message: string;
};
/**
 * Moves one node's params up to the declaration's version, one step at a time. Never resets: a node newer than its
 * declaration, a missing step, a throwing migration or params that fail `validate` all fail the node (it compiles as
 * `unsupported`) and the caller keeps the stored params and `v`.
 */
export declare function migrateNode(node: {
    v?: number;
    params: Params;
}, source: MigrationSource, validate?: (params: Params) => boolean): MigrateResult;
/**
 * `stamp()` on save: each node's `v` is its declaration's `version`. A type without a declaration (its module is gone)
 * keeps the `v` it was stored with: never a reset (02 §2.4).
 */
export declare function stampNode<T extends {
    type: string;
    v?: number;
}>(node: T, versionOf: (type: string) => number | undefined): T & {
    v: number;
};
/** `stampNode` over a node list (import, export and save). */
export declare function stampNodes<T extends {
    type: string;
    v?: number;
}>(nodes: readonly T[], versionOf: (type: string) => number | undefined): Array<T & {
    v: number;
}>;
