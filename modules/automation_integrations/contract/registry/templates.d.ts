// GENERATED from modules/automation/server/registry/templates.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { type FlowDoc, type HostView } from '../engine/compile';
import type { HostRegistry } from '../host/host-registry';
import type { NodeRegistry } from './registry';
/**
 * Phase 02 §2.1 / 07 §7.3: the `automation:template` loader. A template is `{ key, host, title, description, flow,
 * seed? }`. Without `seed` it is offered in "New flow from template"; with `seed` it is instantiated once per tenant.
 * Invalid or a duplicate key: skipped and reported (`skipped`), not offered.
 */
export interface FlowTemplate {
    key: string;
    host: string;
    title: string;
    description: string;
    /** A `roltek-automation-1` flow of known types. */
    flow: FlowDoc;
    seed?: {
        bindAs?: {
            scopeType: string;
        };
    };
    /**
     * The template's own version, a whole number from 1 (default 1). Bump it when the flow changes: the seeder offers tenants the
     * newer content (07 §7.3) and records the version it applied; the change itself is detected by content, so a forgotten bump
     * still offers the upgrade.
     */
    version?: number;
}
export interface TemplateSource {
    module: string;
    template: FlowTemplate;
}
export interface TemplateDeps {
    nodes: NodeRegistry;
    hosts: HostRegistry;
}
/** The host as `compile()` sees it: with a write barrier the host accepts every barrier name the nodes declare. */
export declare function hostView(deps: TemplateDeps, key: string): HostView | undefined;
export declare function checkTemplate(t: FlowTemplate, deps: TemplateDeps): string[];
/**
 * Seeded content is deployed pre-approved by the system only when every node is risk `none` or `low` (07 §7.3) and the deploy
 * rules would ask no confirmation for it (a low node can still declare one, or be a remote-input path to a risky node): such a
 * flow would otherwise land enabled but not approved.
 */
export declare function seedApproval(t: FlowTemplate, nodes: NodeRegistry): 'preapproved' | 'unapproved';
export interface SkippedTemplate {
    module: string;
    key: string;
    problems: string[];
}
export type TemplateRegisterResult = {
    ok: true;
} | {
    ok: false;
    problems: string[];
};
export interface TemplateRegistry {
    /** Contributions refused at register (invalid or a duplicate key), for the contributions check. */
    readonly skipped: SkippedTemplate[];
    register(template: FlowTemplate, module: string): TemplateRegisterResult;
    get(key: string): FlowTemplate | undefined;
    /** Every registered template with the module that contributed it. */
    entries(): Array<{
        key: string;
        module: string;
        template: FlowTemplate;
    }>;
    /** For "New flow from template": the templates of a host without `seed`. */
    offered(host: string): FlowTemplate[];
    /** The templates a tenant gets once. */
    seeded(host?: string): FlowTemplate[];
}
