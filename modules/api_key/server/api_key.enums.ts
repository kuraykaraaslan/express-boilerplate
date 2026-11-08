import { z } from 'zod';

export const ApiKeyScopeEnum = z.enum([
  'read',
  'write',
  'admin',
  // SCIM 2.0 (RFC 7644) — IdP provisioning bearer tokens.
  'scim:read',
  'scim:write',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeEnum>;

export const API_KEY_SCOPES: ApiKeyScope[] = [
  'read',
  'write',
  'admin',
  'scim:read',
  'scim:write',
];

// Environment namespace for a key. Baked into the raw-key prefix
// (`sk_live_…` / `sk_test_…`) so test credentials can never be mistaken for
// production ones and vice versa.
export const ApiKeyEnvEnum = z.enum(['live', 'test']);
export type ApiKeyEnv = z.infer<typeof ApiKeyEnvEnum>;

// ── Resource-level scopes ─────────────────────────────────────────────────
// Beyond the coarse read/write/admin verbs, keys may hold fine-grained
// `resource:action` scopes (e.g. `invoices:read`, `users:write`, `orders:*`).
export const ResourceScopeRegex = /^[a-z0-9_]+:(read|write|admin|\*)$/;

// Scopes of one narrow machine credential that another module owns. They are not coarse verbs, so they stay out of `ApiKeyScope` and
// `API_KEY_SCOPES` (the admin picker); the owning module checks that a key holds exactly this scope and nothing else.
// `fleet_release:publish_draft`: CI may create a release DRAFT (fleet_release) and do nothing else.
// `observability:mcp:read` / `observability:mcp:write` (observability phase 20): the MCP server's two scopes. Matched EXACTLY by that module
// (`mcp.auth.ts`), so a coarse `admin` key is not an MCP key; write is separate, never implied by read and never granted by default.
// `observability_config:read` / `:write`: monitoring-as-code (observability phase 21): export, plan and list (read); apply and detach (write,
//   which implies read). A scope must be listed here, not only match `ResourceScopeRegex`, because a key whose scopes are not in
//   `ApiKeyScopeEnum` or this enum cannot pass `SafeApiKeySchema` and therefore cannot verify at all.
// `observability_ops:ack` / `:incident` / `:silence` / `:note` (observability phase 21, work order 2 item 7): machine access to FOUR operational actions of a
//   workspace, one scope each (acknowledge an alert, declare an incident, start a silence from a template, add an incident note). Matched EXACTLY by
//   observability (`server/ops/ops.auth.ts`): neither `admin`, `*`, `write` nor another scope of this family grants one, so a CI key holds exactly the
//   actions its administrator ticked and nothing else.
// `on_call_config:read` / `:write` (observability work order 2, item 6): export and plan (read), apply and detach (write) of the `roltek-on-call-1`
//   document, the same two-lane rule as `observability_config:*` (`admin` and `*` satisfy them, coarse verbs do not).
// `telemetry:write` (observability phase 17): the OTLP ingest key. Same reason: without it here a telemetry key cannot verify at all.
// `telemetry:browser:write` (observability phase 18.7): the PUBLIC key of the browser snippet. Metrics named `browser_*` and logs only, an Origin allow-list
//   and a low rate limit at ingest; it is never accepted where `telemetry:write` is, nor the other way round.
// `integrations_hub:actions` (41-ui-fixes/15 2.4): the key a connected app's third party calls this workspace's inbound actions with. Minted by
//   integrations_hub at connect and matched EXACTLY by its action route, together with the key's binding to that one connected app; it
//   replaced a tenant-wide `read` + `write` key, which every connect used to mint. Not `admin`, not `*`, not a coarse verb.
export const ServiceScopeEnum = z.enum(['fleet_release:publish_draft', 'integrations_hub:actions', 'observability:mcp:read', 'observability:mcp:write', 'observability_config:read', 'observability_config:write', 'observability_ops:ack', 'observability_ops:incident', 'observability_ops:silence', 'observability_ops:note', 'on_call_config:read', 'on_call_config:write', 'telemetry:write', 'telemetry:browser:write']);

/** Accepts a coarse verb, a service scope OR a `resource:action` scope. */
export const AnyScopeSchema = z.union([ApiKeyScopeEnum, ServiceScopeEnum, z.string().regex(ResourceScopeRegex)]);

/**
 * True when a key's granted scopes satisfy a required scope, honouring the
 * hierarchy: `admin`/`*` grant everything; `write` implies `read`;
 * `resource:admin` / `resource:*` grant any action on that resource;
 * `resource:write` implies `resource:read`.
 */
export function scopeSatisfies(granted: string[], required: string): boolean {
  if (!required) return true;
  if (granted.includes('admin') || granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  if (required === 'read' && granted.includes('write')) return true;
  const [res, action] = required.split(':');
  if (res && action) {
    if (granted.includes(`${res}:admin`) || granted.includes(`${res}:*`)) return true;
    if (action === 'read' && granted.includes(`${res}:write`)) return true;
  }
  return false;
}

/**
 * What `verify` requires of a key: one scope, or any one of several (`{ anyOf }`), each judged by `scopeSatisfies`. The
 * any-of form is for a route that accepts a narrow service scope and, for keys minted before it existed, a coarse verb
 * (integrations_hub's inbound actions: `integrations_hub:actions` or `write`), so the refusal is still verify's own:
 * audited `insufficient_scope`, before the rate limit and the usage record (41-ui-fixes/15 C10).
 */
export type RequiredScope = string | { anyOf: readonly string[] };

/** True when `granted` meets `required` (see `RequiredScope`); nothing required, or an empty any-of, is met. */
export function scopeRequirementMet(granted: string[], required: RequiredScope | undefined): boolean {
  if (!required) return true;
  if (typeof required === 'string') return scopeSatisfies(granted, required);
  return required.anyOf.length === 0 || required.anyOf.some((s) => scopeSatisfies(granted, s));
}

/**
 * A scope that makes the key more powerful than an ADMIN member: `admin` / `*` satisfy every check, and a SCIM write key
 * provisions accounts and maps IdP groups onto tenant roles (OWNER included). Minting or rotating one is an OWNER act
 * (F.api_key.01, fixed 2026-10-20).
 */
export function isPrivilegedScope(scope: string): boolean {
  return scope === 'admin' || scope === '*' || (scope.startsWith('scim:') && scope !== 'scim:read');
}

/**
 * Service scopes that are a narrowing of a coarse verb a plan's allowlist may name: a plan that lets a tenant mint a
 * `write` key lets it mint the narrower key too. For the allowlist only, never for verification (`scopeSatisfies`):
 * a `write` key does not hold these. Before (41-ui-fixes/15 2.4) a tenant whose plan allowed `read` + `write` could
 * connect an integration and, once the key was narrowed, got 403.
 */
const ALLOWLIST_NARROWING_OF: Partial<Record<string, ApiKeyScope>> = {
  'integrations_hub:actions': 'write',
};

/** True when every requested scope is permitted by the allowlist (empty = allow all). */
export function scopesWithinAllowlist(requested: string[], allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (allowlist.includes('admin') || allowlist.includes('*')) return true;
  return requested.every((s) => {
    const coarse = ALLOWLIST_NARROWING_OF[s];
    return scopeSatisfies(allowlist, s) || (coarse !== undefined && scopeSatisfies(allowlist, coarse));
  });
}
