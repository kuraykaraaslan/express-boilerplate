// GENERATED from modules/automation/server/registry/config.types.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { NodeDeclaration } from './node.types';
/**
 * Phase 02 §2.1, §2.5: a config node type (a connection or credential set that nodes reference with a `ref` param).
 * Secrets are substituted host-side at call time and never enter a message, trace, log or export (P7); a `ref` param
 * names a config type or a capability the type `provides` (`mqtt_connection`).
 */
export interface ConfigTypeContribution {
    /** `config.<name>`. */
    type: string;
    declaration: NodeDeclaration;
    /** Params that are secrets: each is a `secret` param without a default. */
    secretFields: string[];
    /** Capabilities this type provides, e.g. `mqtt_connection`. */
    provides?: string[];
    /** The "test" button of the config form. */
    test?(tenantId: string, values: Record<string, unknown>): Promise<ConfigTestResult>;
    /** Save-time problems of a set of values (`allowed_hosts` of `*`, an IP base host not listed); empty when valid. */
    validate?(values: Record<string, unknown>): string[];
    /**
     * Save-time problems that need this tenant's data (a connected app's connector and the API its credential is bound to), run after
     * `validate` passes when a config is created or updated and when a deploy carries it. Empty when valid. It reads non-secret params
     * only (a deploy carries no secrets). A throw refuses the save. `resolve` must still enforce the same rule at call time.
     */
    validateFor?(tenantId: string, values: Record<string, unknown>): Promise<string[]>;
    /** A config whose secret was omitted on import is not ready until someone re-enters it (`missing` names the fields). */
    ready?(values: Record<string, unknown>): {
        ready: true;
    } | {
        ready: false;
        reason: 'not_configured';
        missing: string[];
    };
    /** Secret strings derived from the values (the `Authorization` header built from a username and password) for the scrubber. */
    derivedSecrets?(values: Record<string, unknown>): string[];
    /**
     * What the config looks like to a node at CALL time, when part of it lives in another module: the host calls this for every
     * `ctx.config(ref)`, so a token that module refreshes is always current and is never stored, cached or exported here.
     * `type` presents the config as another type (a connected app as a `config.http_endpoint`); `secrets` lists every secret in
     * the returned values for the scrubber. A throw is "not configured" to the node and its text reaches nobody.
     */
    resolve?(tenantId: string, values: Record<string, unknown>): Promise<{
        type?: string;
        values: Record<string, unknown>;
        secrets?: string[];
    }>;
    /**
     * The certificates the values hold (a custom CA, a client certificate), for the expiry in the config's status (10 §10.3). It
     * reads non-secret params only; the service marks one that ends within 30 days.
     */
    certificates?(values: Record<string, unknown>): ConfigCertificate[];
}
/**
 * What a config test answers: a verdict and a short English message, and optionally a `code` the config form turns into words in
 * the viewer's language (`status`: the HTTP status or the broker's reason code the words name). A result without a `code`, or with
 * one the form does not know, is shown by its message.
 */
export interface ConfigTestResult {
    ok: boolean;
    message?: string;
    code?: ConfigTestCode;
    status?: number;
}
/**
 * `reachable`: the server answered (`status`); `accepted`: it answered a request that needs the credentials; `connected`: the
 * broker took the connection; `auth_rejected`: the credentials were refused (`status`); `server_error`: the server failed
 * (`status`); `unexpected`: it answered a status the test does not expect of that kind of server (`status`); `refused`: the
 * broker refused the connection for another reason (`status`); `held`: a host process holds the broker's fixed client id and its
 * connection is up, so the test did not connect a second time (05 §5.16, G-070); the rest name why nothing was answered (`failed`:
 * none of them).
 */
export type ConfigTestCode = 'reachable' | 'accepted' | 'connected' | 'auth_rejected' | 'server_error' | 'unexpected' | 'refused' | 'timeout' | 'unreachable' | 'reset' | 'tls' | 'blocked' | 'failed' | 'held';
/** One certificate of a config: the param that holds it, its subject and its `notAfter` (epoch ms). */
export interface ConfigCertificate {
    field: string;
    subject: string;
    notAfter: number;
}
/** `expiring`: ends within `CERT_WARNING_DAYS`; `expired`: past its `notAfter`. */
export interface ConfigCertificateStatus extends ConfigCertificate {
    state: 'ok' | 'expiring' | 'expired';
}
/** A certificate that ends within this many days is shown as expiring (10 §10.3). */
export declare const CERT_WARNING_DAYS = 30;
/** The expiry state of each certificate a config holds, judged at `now`. */
export declare function certificateStatus(certs: readonly ConfigCertificate[], now: number): ConfigCertificateStatus[];
export type ConfigRegisterResult = {
    ok: true;
} | {
    ok: false;
    problems: string[];
};
/** Where a contribution came from. */
export interface ConfigTypeSource {
    moduleId: string;
}
export interface SkippedConfigType {
    module: string;
    type: string;
    problems: string[];
}
/** The load-time rules of a config type (02 §2.1), pure: an empty list means valid. Tolerates a malformed contribution. */
export declare function checkConfigType(c: ConfigTypeContribution): string[];
export interface ConfigRegistry {
    /** Contributions refused at register (invalid or a duplicate type), for the contributions check. */
    readonly skipped: SkippedConfigType[];
    register(c: ConfigTypeContribution, source?: ConfigTypeSource): ConfigRegisterResult;
    get(type: string): ConfigTypeContribution | undefined;
    all(): ConfigTypeContribution[];
    /** Every registered type with the module that contributed it. */
    entries(): Array<{
        type: string;
        module: string;
        contribution: ConfigTypeContribution;
    }>;
    moduleOf(type: string): string | undefined;
    /** Every capability a registered type provides, for the `ref` checks. */
    capabilities(): Set<string>;
    /** Config types whose `provides` includes the capability, for a `ref` picker that names a capability. */
    providing(capability: string): string[];
    /** `ref` params of a node declaration that name no known config type or capability (the contributions test). */
    unknownRefs(decl: NodeDeclaration): string[];
}
