// GENERATED from modules/automation/server/host/host-registry.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { AutomationHost } from './host.types';
/**
 * Phase 02 §2.1 / 03 §3.1: loads `automation:host` providers, refuses a duplicate `key` and a descriptor that cannot
 * work, and answers `hostOf(key)`. A flow whose host is not installed is `host_missing` (07). Invalid: skipped and
 * logged, its flows stay stored. Duplicate `key` at build time: a build error naming both modules.
 */
export type HostRegisterResult = {
    ok: true;
} | {
    ok: false;
    problems: string[];
};
export interface HostSource {
    module: string;
    host: AutomationHost;
}
export interface HostRegistryOptions {
    /** Names of the `automation:choices` lists the build has; an entry scope naming another is invalid. Absent = not checked. */
    choices?: ReadonlySet<string>;
}
export interface DuplicateHostError extends Error {
    readonly key: string;
    readonly modules: [
        string,
        string
    ];
}
/** Every host offers these sample sources (03 §3.1); a host adds its own. */
export declare const BUILTIN_SAMPLE_SOURCES: readonly [
    "declaration",
    "pasted",
    "last_run"
];
/** The shape rules of a host descriptor. `enqueue` is optional for a descriptor that is only a label (the generic host's descriptor carries one that delegates to the runtime's producer). */
export declare function checkHost(h: AutomationHost, opts?: HostRegistryOptions): string[];
export interface SkippedHost {
    module: string;
    key: string;
    problems: string[];
}
export type HostLookup = {
    host: AutomationHost;
} | {
    error: 'host_missing';
};
export interface HostRegistry {
    /** Contributions that were refused, with the module that made them (a CI failure for the contributor kit). */
    readonly skipped: SkippedHost[];
    /** Runtime rule: an invalid or duplicate host is refused and recorded in `skipped`, never thrown (see `buildHostRegistry`). */
    register(host: AutomationHost, source?: {
        module: string;
    }, opts?: HostRegistryOptions): HostRegisterResult;
    get(key: string): AutomationHost | undefined;
    /** `host_missing` when the host of a stored flow is not installed. */
    require(key: string): AutomationHost | 'host_missing';
    /** A flow whose host is not installed (or was skipped) is `host_missing` and cannot be deployed (trap 2). */
    hostOf(key: string): HostLookup;
    keys(): string[];
    readonly hosts: ReadonlyMap<string, {
        module: string;
        host: AutomationHost;
    }>;
}
/** Build-time rule (02 §2.1): invalid hosts are skipped, a duplicate key throws `DuplicateHostError` naming both modules. */
export declare function buildHostRegistry(sources: readonly HostSource[], opts?: HostRegistryOptions): HostRegistry;
