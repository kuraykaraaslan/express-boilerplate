import 'reflect-metadata';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { PERMISSION_MATRIX } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.permissions';
import TenantRoleService, { roleSetGrants } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.service';
import type { CachedRoleSet } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.types';
import type { TenantMemberRole, PermissionFloor } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import AbacPolicyService from './auth_abac.policy.service';
import AbacSettingsService, { type AbacRuntimeSettings } from './auth_abac.settings.service';
import { evaluatePolicies } from './auth_abac.eval';
import { getCached, setCached } from './auth_abac.decision.cache';
import type { AuthzRequest, Decision, Policy } from './auth_abac.types';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { authAbacAttributeLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/auth_abac.attribute';
import Logger from '@kuraykaraaslan-labs/logger';

// Subject attributes the PEP/PDP own. A provider contributes a NEW namespace
// (`subject.<key>`); one that reused one of these would rewrite who the caller is
// or what they hold (`permissions` is read as an outright grant), so such a
// contribution is refused. Keys the subject already carries are refused as well.
const RESERVED_SUBJECT_KEYS = new Set([
  'id', 'email', 'role', 'roles', 'permissions', 'amr', 'acr',
  '__proto__', 'prototype', 'constructor',
]);

const ATTRIBUTE_POINT = 'auth_abac:attribute';

type AttributeProvider = (tid: string) => Promise<Record<string, unknown>>;

/**
 * Lazily enrich the subject with contributed ABAC attributes (the
 * `auth_abac:attribute` providers — e.g. subscription/entitlements). Runs ONLY
 * when a loaded policy references a contributed attribute key, so the common case
 * (no such policy) pays nothing. Best-effort: a provider failure never blocks
 * evaluation. See phases/monetization/3.md §3.3.
 *
 * A slow provider must not hold an authorization decision hostage: past the
 * point's `timeoutMs` (2 s, auth_abac/module.json) the attribute stays absent —
 * the same outcome as a provider failure. The point is platform-gated
 * (`gate: "platform"`): a provider is asked whatever the tenant switched on, and
 * left out only when the platform stopped its module (banned, retired, missing).
 */
async function enrichSubjectFromExtensions(
  tenantId: string,
  req: AuthzRequest,
  policies: unknown[],
): Promise<void> {
  if (!policies.length) return;
  const ctx = tenantCtx(tenantId);
  let declared;
  try {
    // Metadata only (no code is loaded): decides whether there is anything to ask at all.
    declared = await ext.contributions(ATTRIBUTE_POINT, ctx);
  } catch {
    return;
  }
  if (!declared.length) return;
  const policyJson = JSON.stringify(policies);
  const subject = req.subject as Record<string, unknown>;
  const wanted = new Set<string>();
  for (const { key } of declared) {
    if (!key || !policyJson.includes(key) || wanted.has(key)) continue;
    if (RESERVED_SUBJECT_KEYS.has(key) || Object.hasOwn(subject, key)) {
      Logger.warn(`ABAC: attribute provider '${key}' ignored: the key collides with a core subject attribute`);
      continue;
    }
    wanted.add(key);
  }
  if (!wanted.size) return;

  const { results } = await ext.aggregate<AttributeProvider, { key: string; value: unknown } | null>(
    ATTRIBUTE_POINT, ctx, authAbacAttributeLoaders,
    async (provider, _signal, contribution) => {
      const key = contribution.key;
      return key && wanted.has(key) ? { key, value: await provider(tenantId) } : null;
    },
  );
  for (const { value: attribute } of results) {
    // Two providers of one key: the first in order keeps it, as it always did.
    if (attribute && !Object.hasOwn(subject, attribute.key)) subject[attribute.key] = attribute.value;
  }
}

// Coarse ordering used when a caller passes a `fallbackRole` threshold instead
// of relying on a named permission-matrix key.
const ROLE_RANK: Record<PermissionFloor, number> = { OWNER: 3, ADMIN: 2, USER: 1, GUEST: 0 };

export interface EvaluateOptions {
  fallbackRole?: TenantMemberRole;
  /** Skip the decision cache (required for time-dependent policies). */
  cache?: boolean;
  /**
   * Pre-resolved runtime settings. The PEP guard reads these once to decide
   * shadow-vs-enforce and passes them here so the PDP does not re-read them.
   * Omitted callers (e.g. `can()`) let the PDP resolve them for audit gating.
   */
  settings?: AbacRuntimeSettings;
  /**
   * What to do when NO policy targets the request (`not_applicable`):
   *  - `'rbac'` (default): bridge to the RBAC matrix / `fallbackRole` threshold.
   *  - `'permit'`: additive — the coarse route guard already authorized, so ABAC
   *    only *further restricts* via explicit policies.
   *  - `'permission'`: enforce the tenant's role→permission matrix for the
   *    required permission (`req.action`). An explicit removal denies; unseeded /
   *    unknown permissions permit (migration-safe). Used by the permission PEP.
   */
  onNotApplicable?: 'rbac' | 'permit' | 'permission';
  /**
   * The installation's config/access.ts verdict for this subject (docs/phases/45-install-config D45-4). A removed id is
   * denied before any policy is read, so no policy, role matrix or group can hand it back; a granted id is permitted
   * where no policy applied, over the role matrix. An explicit policy deny still refuses a granted id: a policy is a
   * condition (an address, a second factor), and a grant does not switch conditions off.
   */
  install?: { removed: ReadonlySet<string>; granted: ReadonlySet<string> };
}

/**
 * Does a custom role the subject holds grant this action?
 *
 * Reads `subject.permissions`, which the PDP adapter resolved once per request
 * from the member's `roleKeys` — the PDP core never learns where a permission
 * set came from, which is what keeps roles DATA rather than a second engine.
 *
 * Absent attribute = no custom groups (or the lookup failed) = no opinion, so
 * the built-in matrix decides exactly as it did before.
 */
function grantedByCustomRole(req: AuthzRequest): boolean {
  const permissions = req.subject.permissions;
  return Array.isArray(permissions) && permissions.includes(req.action);
}

/**
 * How the fallbacks ask "does this built-in role grant this permission?" — the
 * `TenantRoleService.hasPermission` contract (true / explicit false / undefined).
 * A parameter so `evaluateMany` can answer from a role set it loaded once
 * instead of re-reading it per permission; the default is the single read.
 */
export type RoleGrantLookup = (tenantId: string, roleKey: string, permissionId: string) => Promise<boolean | undefined>;

const readRoleGrant: RoleGrantLookup = (tenantId, roleKey, permissionId) =>
  TenantRoleService.hasPermission(tenantId, roleKey, permissionId);

export default class AbacPdpService {
  /**
   * The PDP entry point. Returns a deterministic permit/deny for a request:
   *   1. decision cache (deterministic requests only)
   *   2. active policy-set under deny-overrides
   *   3. RBAC fallback when no policy applied (`not_applicable`)
   *   4. default-deny (fail-closed)
   * Every non-cached evaluation is best-effort written to the audit log.
   */
  static async evaluate(
    tenantId: string,
    req: AuthzRequest,
    opts: EvaluateOptions = {},
  ): Promise<Decision> {
    const useCache = opts.cache !== false;

    if (useCache) {
      const cached = await getCached(tenantId, req);
      if (cached) return cached;
    }

    const settings = opts.settings ?? (await AbacSettingsService.getRuntimeSettings(tenantId));
    const policies = await AbacPolicyService.loadSet(tenantId);
    await enrichSubjectFromExtensions(tenantId, req, policies);
    const decision = await this.decide(tenantId, req, policies, settings, opts, readRoleGrant);

    this.auditDecision(tenantId, req, decision, settings);
    if (useCache) await setCached(tenantId, req, decision);
    return decision;
  }

  /**
   * {@link evaluate} for many requests at once, without the decision cache.
   *
   * Exists for bulk UI gating (`grantedPermissions`), which asked the PDP one
   * permission at a time: each call re-read and re-parsed the policy set and
   * re-read the role set, so an admin shell load paid that up to ~73 times in a
   * row. Here the settings, the policy set and the role set are read ONCE and
   * every request is decided in memory by the same `decide` the single path
   * uses, so the verdicts are identical (pinned by a parity test).
   *
   * Each decision is audited as `evaluate` would audit it, but for one kind: a
   * permission the installation's config removed or granted (`install_config`).
   * Asking it to draw a menu is the configuration answering, not anyone trying to
   * do the thing (e2e run 1, E21: 64,213 such denies on the demo in five days,
   * one per hidden menu entry per page, one database write each, and every one in
   * the home feed). A request the config refuses is still audited, by `evaluate`.
   *
   * Contributed subject attributes are resolved once per distinct subject
   * object: callers that share one subject across requests (the usual case)
   * pay for the providers once, and a second pass would read the key it just
   * added as a collision.
   */
  static async evaluateMany(
    tenantId: string,
    reqs: AuthzRequest[],
    opts: Omit<EvaluateOptions, 'cache'> = {},
  ): Promise<Decision[]> {
    if (reqs.length === 0) return [];
    const settings = opts.settings ?? (await AbacSettingsService.getRuntimeSettings(tenantId));
    const policies = await AbacPolicyService.loadSet(tenantId);

    const enriched = new Set<object>();
    for (const req of reqs) {
      if (enriched.has(req.subject)) continue;
      enriched.add(req.subject);
      await enrichSubjectFromExtensions(tenantId, req, policies);
    }

    // Loaded lazily, as the single path does: a batch decided entirely by
    // policies (or by custom groups) never reads the role set at all.
    let roleSet: Promise<CachedRoleSet> | undefined;
    const lookup: RoleGrantLookup = async (tid, roleKey, permissionId) =>
      roleSetGrants(await (roleSet ??= TenantRoleService.roleSet(tid)), roleKey, permissionId);

    const decisions: Decision[] = [];
    for (const req of reqs) {
      const decision = await this.decide(tenantId, req, policies, settings, opts, lookup);
      if (decision.reason !== 'install_config') this.auditDecision(tenantId, req, decision, settings);
      decisions.push(decision);
    }
    return decisions;
  }

  /** Policy set under deny-overrides, then the configured not-applicable fallback. */
  private static async decide(
    tenantId: string,
    req: AuthzRequest,
    policies: Policy[],
    settings: AbacRuntimeSettings,
    opts: EvaluateOptions,
    lookup: RoleGrantLookup,
  ): Promise<Decision> {
    if (opts.install?.removed.has(req.action)) return { effect: 'deny', reason: 'install_config' };
    const policyDecision = evaluatePolicies(policies, req, { regexTimeoutMs: settings.regexTimeoutMs });
    if (policyDecision.reason !== 'not_applicable') return policyDecision;
    if (opts.install?.granted.has(req.action)) return { effect: 'permit', reason: 'install_config' };
    if (opts.onNotApplicable === 'permit') return { effect: 'permit', reason: 'not_applicable' };
    if (opts.onNotApplicable === 'permission') return this.resolvePermissionGrant(tenantId, req, lookup);
    return this.resolveRbacFallback(tenantId, req, opts.fallbackRole, lookup);
  }

  /**
   * Bridge ABAC `not_applicable` to the existing RBAC. Prefer an explicit
   * `fallbackRole` threshold (no DB); otherwise consult the tenant's persisted
   * role→permission grants (the editable Access Rights matrix) and, only when
   * the tenant is unseeded, the static PERMISSION_MATRIX. No grant found →
   * default-deny (fail-closed). Zero-regression: an unseeded tenant behaves
   * exactly as the static matrix did.
   */
  static async resolveRbacFallback(
    tenantId: string,
    req: AuthzRequest,
    fallbackRole?: TenantMemberRole,
    lookup: RoleGrantLookup = readRoleGrant,
  ): Promise<Decision> {
    const role = req.subject.role;
    const subjectRole =
      role === 'OWNER' || role === 'ADMIN' || role === 'USER' ? (role as TenantMemberRole) : undefined;

    if (fallbackRole) {
      const granted =
        subjectRole !== undefined && ROLE_RANK[subjectRole] >= ROLE_RANK[fallbackRole];
      return granted
        ? { effect: 'permit', reason: 'rbac_fallback' }
        : { effect: 'deny', reason: 'default_deny' };
    }

    // A custom group the member holds is ADDITIVE: assigning somebody a group
    // IS the grant, so it permits even where the built-in matrix says no. The
    // reverse never happens — a group cannot take a permission away — which
    // keeps removal in ONE place (the matrix) instead of two that can disagree.
    if (grantedByCustomRole(req)) return { effect: 'permit', reason: 'rbac_fallback' };

    if (subjectRole !== undefined) {
      // Persisted, editable grants take precedence when the tenant has seeded them.
      const persisted = await lookup(tenantId, subjectRole, req.action);
      if (persisted !== undefined) {
        return persisted
          ? { effect: 'permit', reason: 'rbac_fallback' }
          : { effect: 'deny', reason: 'default_deny' };
      }
      // Unseeded tenant → static matrix (byte-identical to what was seeded).
      const row = PERMISSION_MATRIX.find((r) => r.key === req.action);
      if (row) {
        return row.roles[subjectRole]
          ? { effect: 'permit', reason: 'rbac_fallback' }
          : { effect: 'deny', reason: 'default_deny' };
      }
    }

    return { effect: 'deny', reason: 'default_deny' };
  }

  /**
   * Permission enforcement fallback (the PEP guard). When no ABAC policy applies,
   * consult the tenant's role→permission matrix for `req.action` (the required
   * permission): an explicit removal (`hasPermission === false`) denies; a grant
   * or an unknown/unseeded permission (`true`/`undefined`) permits. Because
   * `hasPermission` only returns `false` when another role in the tenant still
   * grants the permission, a permission added after the tenant last edited access
   * control never locks anyone out (migration-safe), and a subject with a
   * non-built-in role is permitted (the coarse route guard already gated it).
   */
  static async resolvePermissionGrant(
    tenantId: string,
    req: AuthzRequest,
    lookup: RoleGrantLookup = readRoleGrant,
  ): Promise<Decision> {
    const role = req.subject.role;
    const subjectRole =
      role === 'OWNER' || role === 'ADMIN' || role === 'USER' ? (role as TenantMemberRole) : undefined;
    if (subjectRole === undefined) return { effect: 'permit', reason: 'rbac_fallback' };
    // A custom group grants outright — see `resolveRbacFallback` for why this
    // is additive-only.
    if (grantedByCustomRole(req)) return { effect: 'permit', reason: 'rbac_fallback' };
    const granted = await lookup(tenantId, subjectRole, req.action);
    return granted === false
      ? { effect: 'deny', reason: 'default_deny' }
      : { effect: 'permit', reason: 'rbac_fallback' };
  }

  /**
   * Best-effort decision log — a logging failure never affects the verdict.
   * Volume is gated by `decisionLogMode` ('off' skips, 'deny_only' logs just
   * denies). Under shadow mode the entry carries `enforced:false` so the log
   * makes clear the deny was observed but not blocked.
   */
  private static auditDecision(
    tenantId: string,
    req: AuthzRequest,
    decision: Decision,
    settings: AbacRuntimeSettings,
  ): void {
    if (settings.decisionLogMode === 'off') return;
    if (settings.decisionLogMode === 'deny_only' && decision.effect !== 'deny') return;
    // Only permits are sampled: a deny is the record someone will want later.
    const sampleRate = settings.decisionLogSampleRate ?? 100;
    if (decision.effect === 'permit' && sampleRate < 100 && !(Math.random() * 100 < sampleRate)) return;

    const subjectId = typeof req.subject.id === 'string' ? req.subject.id : null;
    // The installation's config is enforced in shadow mode too (decisionBlocks, guard.core.next).
    const enforced = !settings.shadowMode || decision.reason === 'install_config';
    AuditLogService.log({
      tenantId,
      actorType: subjectId ? 'USER' : 'SYSTEM',
      actorId: subjectId,
      action: 'abac.decision',
      resourceType: 'abac_policy',
      resourceId: decision.policyId ?? req.resource.type,
      metadata: {
        tenantId,
        action: req.action,
        resourceType: req.resource.type,
        effect: decision.effect,
        reason: decision.reason,
        enforced,
        subjectId,
        ...(decision.effect === 'permit' && sampleRate < 100 ? { sampleRate } : {}),
      },
    });
  }
}
