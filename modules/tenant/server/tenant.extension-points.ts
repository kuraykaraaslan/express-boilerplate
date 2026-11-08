import { ext, systemCtx, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { tenantDefaultPlanLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.default_plan'
import { tenantDefaultModulesLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.default_modules'
import { tenantPurgeStepLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.purge_step'
import { tenantSubscriptionHealthLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.subscription_health'
import { tenantLifecycleSinkLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.lifecycle_sink'
import { tenantSeedStepLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.seed_step'
import { tenantOnboardingCheckLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.onboarding_check'
import { tenantSlugChangedLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.slug_changed'
import { tenantSuspensionLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.suspension'

/**
 * What `tenant` lets the module that sells plans (`tenant_subscription`, a higher edition) do at three moments of a tenant's life,
 * and the module lifecycle install a new tenant's default modules, without importing either. Each point is declared in tenant/module.json `extensionPoints`; with no contributor, nothing happens.
 */
export const TENANT_DEFAULT_PLAN_POINT = 'tenant:default_plan'
export const TENANT_DEFAULT_MODULES_POINT = 'tenant:default_modules'
export const TENANT_PURGE_STEP_POINT = 'tenant:purge_step'
export const TENANT_SUBSCRIPTION_HEALTH_POINT = 'tenant:subscription_health'
export const TENANT_LIFECYCLE_SINK_POINT = 'tenant:lifecycle_sink'
export const TENANT_SEED_STEP_POINT = 'tenant:seed_step'
export const TENANT_ONBOARDING_CHECK_POINT = 'tenant:onboarding_check'
export const TENANT_SLUG_CHANGED_POINT = 'tenant:slug_changed'
export const TENANT_SUSPENSION_POINT = 'tenant:suspension'

/** Gives a newly created tenant its default plan. Errors propagate to the caller, which records them without failing the creation. */
export interface TenantDefaultPlanProvider {
  assignDefaultPlan(tenantId: string): Promise<void>
}

/** Installs the platform's default modules into a newly created tenant (module_lifecycle). Errors propagate like the plan's. */
export interface TenantDefaultModulesProvider {
  applyDefaultModules(tenantId: string): Promise<{ installed: string[]; skipped: Array<{ moduleId: string; error: string }> }>
}

/** A step of a new tenant's seeding that belongs to another module (tenant_domain's wildcard subdomain). Throws to report a failure. */
/**
 * What the creator of a tenant asked for that a seed step may honour: `baseDomain` is the platform base domain a self-service sign-up chose
 * for its free subdomain (tenant_domain, phase 56), which tenant_domain validates. `language` is the default language of the fleet zone the
 * sign-up came through (fleet phase 6c, F41); tenant's own settings seed reads it in place of the region's language.
 */
export interface TenantSeedHints {
  readonly baseDomain?: string
  readonly language?: string
}

export interface TenantSeedStep {
  seed(tenantId: string, hints?: TenantSeedHints): Promise<void>
}

/** One onboarding checklist item another module owns; the contribution's `key` is the step id (tenant_domain: `dns_configured`). */
export interface TenantOnboardingCheck {
  done(tenantId: string): Promise<boolean>
}

/** A slug rename, as a listener is told it. `previousSlug` is null when the tenant had none. */
export interface TenantSlugChange {
  tenantId: string
  previousSlug: string | null
  slug: string | null
}

/** Keeps something named after the slug in step with it (tenant_domain's free subdomain). Must be idempotent. */
export interface TenantSlugChangeListener {
  slugChanged(event: TenantSlugChange): Promise<void>
}

/** A tenant entering (`suspended: true`) or leaving (`false`) SUSPENDED, as a listener is told it. */
export interface TenantSuspensionChange {
  tenantId: string
  suspended: boolean
}

/** Gives a suspension its immediate effect beyond the request path (sessions, live sockets), and undoes what must be undone on resume. */
export interface TenantSuspensionListener {
  suspensionChanged(event: TenantSuspensionChange): Promise<void>
}

/** A teardown step of the purge cascade that belongs to another module (cancelling billing). Best-effort: the cascade logs a failure and goes on. */
export interface TenantPurgeStep {
  purge(tenantId: string): Promise<void>
}

export type SubscriptionHealth = 'trialing' | 'active' | 'grace_period' | 'past_due' | 'expired'

/** The subscription health of tenants for the platform console. A tenant with no subscription is simply absent from the answer. */
export interface SubscriptionHealthProvider {
  healthOf(tenantIds: string[]): Promise<Record<string, SubscriptionHealth>>
}

/**
 * A lifecycle change of a tenant, as the sink is told it: ids, a type, a time and, for some types, a G-class payload (counts and sha256 hashes keyed
 * by UPPER_SNAKE names, never a name or free text): a legal hold's end (`counts.UNTIL`, unix seconds) and the hash of its reason (`hashes.REASON`).
 */
export interface TenantLifecycleEvent {
  tenantId: string
  type: 'PROVISIONED' | 'SUSPENDED' | 'RESUMED' | 'DELETION_REQUESTED' | 'RESTORED' | 'PURGED' | 'LEGAL_HOLD_SET' | 'LEGAL_HOLD_CLEARED' | 'DR_FAILOVER' | 'DR_FAILBACK'
  occurredAt: Date
  /**
   * G only. `assignmentVersion`: the version the row was written at (a DR takeover). `failoverOrder`: a DR_FAILOVER taken on the regional fallback path
   * carries the regional operator's signed order (ids, timestamps, a signature), which the receipt forwards for the directory to verify (decision F1).
   */
  payload?: { commandJti?: string; assignmentVersion?: number; counts?: Record<string, number>; hashes?: Record<string, string>; failoverOrder?: Record<string, unknown> }
  /**
   * D249: the modules whose session-ending orders for this change were already recorded in the change's own transaction
   * (`session_end:order_source`); their sinks skip it. Not part of any receipt (the fleet agent forwards `payload` only).
   */
  sessionEndOrderedBy?: string[]
}

/** Reports a tenant's lifecycle changes elsewhere (the fleet agent's lifecycle receipts). */
export interface TenantLifecycleSink {
  record(event: TenantLifecycleEvent): Promise<void>
}

/** The modules' failures as one line (`<module>: <message>; …`), for this file's own reports. */
const describeFailures = (failed: ReadonlyArray<{ moduleId: string; message: string }>): string =>
  failed.map((f) => `${f.moduleId}: ${f.message}`).join('; ')

/**
 * Tells every contributed sink about one change. Best-effort: a sink that fails is logged and the change it reports stands.
 *
 * Platform gate (module.json): the receipts are the node's report to the fleet about the tenant, not work inside it, and the sink
 * (`fleet_agent`) is node infrastructure no tenant installs — gating it by the tenant's modules would silence it for all.
 */
export async function recordLifecycle(event: TenantLifecycleEvent): Promise<void> {
  const { failed } = await ext.fanOut<TenantLifecycleSink>(
    TENANT_LIFECYCLE_SINK_POINT, tenantCtx(event.tenantId), tenantLifecycleSinkLoaders,
    (sink) => sink.record(event), { sequential: true },
  )
  if (failed.length === 0) return
  // Loaded here, on the failure path only: the logger reads the environment, which this module's callers must not need just to declare points.
  const { default: Logger } = await import('@kuraykaraaslan-labs/logger')
  Logger.error(`[tenant] lifecycle sink ${failed.map((f) => f.moduleId).join(', ')} failed for ${event.type} of tenant ${event.tenantId}: ${describeFailures(failed)}`)
}

/**
 * Tells every listener that the tenant's slug changed. Best-effort: a listener that fails is logged and the rename stands.
 *
 * Platform gate (module.json): the free subdomain named after the slug is the platform's routing of the tenant, so its
 * owner (tenant_domain) is told whatever the tenant switched on.
 */
export async function announceSlugChange(event: TenantSlugChange): Promise<void> {
  const { failed } = await ext.fanOut<TenantSlugChangeListener>(
    TENANT_SLUG_CHANGED_POINT, tenantCtx(event.tenantId), tenantSlugChangedLoaders,
    (listener) => listener.slugChanged(event), { sequential: true },
  )
  if (failed.length === 0) return
  const { default: Logger } = await import('@kuraykaraaslan-labs/logger')
  Logger.error(`[tenant] slug-change listener ${failed.map((f) => f.moduleId).join(', ')} failed for tenant ${event.tenantId}: ${describeFailures(failed)}`)
}

/**
 * Tells every listener that the tenant entered or left SUSPENDED (docs/phases/02-fleet/05 section 7 stage 7). Best-effort: a listener
 * that fails is logged and the status change stands; the request path refuses a suspended tenant on its own (tenant_session), so
 * what a listener adds (revoked sessions, dropped sockets) is the immediate end of what was already open.
 *
 * Platform gate (module.json): ending a suspended tenant's sessions and sockets is a security action, owed whatever the tenant switched on.
 */
export async function announceSuspension(event: TenantSuspensionChange): Promise<void> {
  const { failed } = await ext.fanOut<TenantSuspensionListener>(
    TENANT_SUSPENSION_POINT, tenantCtx(event.tenantId), tenantSuspensionLoaders,
    (listener) => listener.suspensionChanged(event), { sequential: true },
  )
  if (failed.length === 0) return
  const { default: Logger } = await import('@kuraykaraaslan-labs/logger')
  Logger.error(`[tenant] suspension listener ${failed.map((f) => f.moduleId).join(', ')} failed for tenant ${event.tenantId} (${event.suspended ? 'suspended' : 'resumed'}): ${describeFailures(failed)}`)
}

/**
 * Runs every contributed default-plan assignment for the tenant. Every contributor runs even when an earlier one
 * fails; the failures are then thrown together, so the caller still records them.
 *
 * Platform gate (module.json): a new tenant has not installed the module that sells plans (it is off by default), and its plan is
 * the platform's business, not one of the tenant's features — gated, no new tenant would ever get one.
 */
export async function assignDefaultPlan(tenantId: string): Promise<void> {
  const { failed } = await ext.fanOut<TenantDefaultPlanProvider>(
    TENANT_DEFAULT_PLAN_POINT, tenantCtx(tenantId), tenantDefaultPlanLoaders,
    (provider) => provider.assignDefaultPlan(tenantId), { sequential: true },
  )
  if (failed.length === 1) throw new Error(failed[0]!.message)
  if (failed.length > 1) throw new Error(describeFailures(failed))
}

/**
 * Runs every contributed default-module installer for the tenant (module_lifecycle's platform default list); the results
 * are merged. A failing installer is thrown, as before, so tenant creation reports it.
 */
export async function applyDefaultModules(tenantId: string): Promise<{ installed: string[]; skipped: Array<{ moduleId: string; error: string }> }> {
  const { results, failed } = await ext.aggregate<TenantDefaultModulesProvider, { installed: string[]; skipped: Array<{ moduleId: string; error: string }> }>(
    TENANT_DEFAULT_MODULES_POINT, tenantCtx(tenantId), tenantDefaultModulesLoaders,
    (provider) => provider.applyDefaultModules(tenantId), { sequential: true },
  )
  if (failed.length === 1) throw new Error(failed[0]!.message)
  if (failed.length > 1) throw new Error(describeFailures(failed))
  return {
    installed: results.flatMap((r) => r.value.installed),
    skipped: results.flatMap((r) => r.value.skipped),
  }
}

/**
 * Runs every contributed seed step for a new tenant, one after another in order; returns the failures as
 * `<module>: <message>` for the seeding report (a failed step never fails the creation).
 *
 * Platform gate (module.json): the tenant was created a moment ago and its module activation may not be seeded yet,
 * so a behaviour gate would skip every step; the steps are the platform's provisioning of the tenant (its routing
 * subdomain), not features the tenant switched on.
 */
export async function runSeedSteps(tenantId: string, hints?: TenantSeedHints): Promise<string[]> {
  const { failed } = await ext.fanOut<TenantSeedStep>(
    TENANT_SEED_STEP_POINT, tenantCtx(tenantId), tenantSeedStepLoaders,
    (step) => step.seed(tenantId, hints), { sequential: true },
  )
  return failed.map((f) => `${f.moduleId}: ${f.message}`)
}

/**
 * The onboarding checklist items other modules own, by step id (the contribution's key). Every active check is listed;
 * one that fails, times out or answers anything but `true` reads as not done. A module that is off for the tenant has
 * no item (behaviour gate).
 */
export async function onboardingChecks(tenantId: string): Promise<Record<string, boolean>> {
  const ctx = tenantCtx(tenantId)
  const out: Record<string, boolean> = {}
  for (const c of await ext.contributions(TENANT_ONBOARDING_CHECK_POINT, ctx, { keepQuarantined: true })) if (c.key) out[c.key] = false
  const { results } = await ext.aggregate<TenantOnboardingCheck, boolean>(
    TENANT_ONBOARDING_CHECK_POINT, ctx, tenantOnboardingCheckLoaders,
    async (check) => (await check.done(tenantId)) === true,
  )
  for (const { contribution, value } of results) if (contribution.key) out[contribution.key] = value
  return out
}

/**
 * Runs every contributed purge step for the tenant (a data-gate point: a module switched off still tears down what it
 * holds). Every step runs even when an earlier one fails; returns the failures as `<module>: <message>` for the cascade's
 * error report.
 */
export async function runPurgeSteps(tenantId: string): Promise<string[]> {
  const { failed } = await ext.fanOut<TenantPurgeStep>(
    TENANT_PURGE_STEP_POINT, tenantCtx(tenantId), tenantPurgeStepLoaders,
    (step) => step.purge(tenantId), { sequential: true },
  )
  return failed.map((f) => `${f.moduleId}: ${f.message}`)
}

/**
 * Subscription health per tenant id, merged over every contributor; empty when none is installed. A failing contributor
 * leaves its tenants without a health badge; it must not turn the tenants list into a 500.
 *
 * System context: the platform console's tenants list, across tenants.
 */
export async function subscriptionHealthOf(tenantIds: string[]): Promise<Record<string, SubscriptionHealth>> {
  const out: Record<string, SubscriptionHealth> = {}
  if (tenantIds.length === 0) return out
  const { results } = await ext.aggregate<SubscriptionHealthProvider, Record<string, SubscriptionHealth>>(
    TENANT_SUBSCRIPTION_HEALTH_POINT, systemCtx('platform tenants list'), tenantSubscriptionHealthLoaders,
    (provider) => provider.healthOf(tenantIds),
  )
  for (const { value } of results) Object.assign(out, value)
  return out
}
