// GENERATED from modules/automation/server/registry/registry.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { NodeDeclView, RegistryView } from '../engine/compile';
import type { Params } from '../engine/migrate';
import { type Problem } from '../engine/problems';
import type { ContributionSource, DeployCheckCtx, NodeContribution, NodeDeclaration, TenantHostContext } from './node.types';
/**
 * Phase 02 §2.1, §2.6: the node registry. `register` checks a contribution against the load-time rules of §2.1 (an
 * invalid one is skipped and reported, never half-loaded); `view` resolves readiness per tenant and host and hands
 * `compile()` a pure `RegistryView`.
 */
export interface RegistryOptions {
    /** Hosts a node may name in `hosts`. Absent: not checked. */
    knownHosts?: ReadonlySet<string>;
    /** Types that may declare `originatorRewrite` (01 §1.1). */
    originatorRewriteAllow?: readonly string[];
    /** Called when a throwing `ready()` is counted as `not_configured`. */
    onReadyError?: (type: string, e: unknown) => void;
}
export type RegisterResult = {
    ok: true;
} | {
    ok: false;
    problems: string[];
};
/** A contribution that was refused, for the contributions check and the loader's log. */
export interface SkippedNode {
    module: string;
    type: string;
    problems: string[];
}
/** What a node of this registry looks like once registered (the declaration has the fragments and the cloud numbers). */
export interface RegisteredNode {
    type: string;
    module: string;
    contribution: NodeContribution;
    declaration: NodeDeclaration;
}
/** The readiness a view hands to `compile()`: `page` says where the user can fix a `not_configured` node (§2.6). */
export type ViewReady = NodeDeclView['ready'];
/**
 * The load-time rules of §2.1 and §2.6 that need no other module, pure: an empty list means valid. A malformed
 * contribution (no declaration, no executor) is a problem, never a throw.
 */
export declare function checkContribution(c: NodeContribution, opts?: RegistryOptions): string[];
export interface NodeRegistry {
    /** Contributions refused at register (invalid or a duplicate type), for the contributions check. */
    readonly skipped: SkippedNode[];
    /** Contributions accepted although a rule is not met yet (see `UNDECLARED_BY`). */
    readonly warnings: SkippedNode[];
    register(c: NodeContribution, source: ContributionSource): RegisterResult;
    has(type: string): boolean;
    types(): string[];
    contribution(type: string): NodeContribution | undefined;
    /** Every registered node with the module that contributed it (declaration: fragments and cloud numbers applied). */
    entries(): RegisteredNode[];
    moduleOf(type: string): string | undefined;
    /**
     * Runs the deploy-time checks of every node of the flows (07 §7.5): the credential lint of 10 §10.1 (a literal that
     * looks like a credential in a param that is not a `secret` one is a `range` problem: move it to a config node) and
     * the contributed `deployCheck`. A throwing check refuses the deploy (fail closed).
     */
    deployChecks(tenantId: string, flows: ReadonlyArray<{
        id: string;
        nodes: ReadonlyArray<{
            id: string;
            type: string;
            params: Params;
        }>;
    }>, host?: {
        key: string;
        latestValue: boolean;
        msgTypes?: readonly string[];
    }, permissions?: ReadonlySet<string>, config?: DeployCheckCtx['config'], entity?: DeployCheckCtx['entity']): Promise<Problem[]>;
    /** The pure view `compile()` needs, for one tenant and host. Readiness is resolved up front (it may be async). */
    view(ctx: TenantHostContext): Promise<RegistryView>;
    /**
     * The view for a judgement on structure alone (a template, the contributor kit): every type is ready, whatever the
     * tenant's modules, plan or `ready()`, except a node that does not run on `host` (`host_mismatch`).
     */
    structuralView(host: string): RegistryView;
}
