// Shared vocabulary of module governance (docs/phases/25-marketplace/03-module-governance).
// Entities, services and routes import these; this file imports nothing.

/** Who installed a module for a tenant, recorded on its `installs` row when the row is created. */
export const INSTALL_ORIGINS = ['tenant', 'plan', 'operator', 'default'] as const;
export type InstallOrigin = (typeof INSTALL_ORIGINS)[number];

/**
 * Why the PLATFORM closed an installed module (the row is inactive). A person deactivating a
 * module leaves this null. Plan provisioning reactivates only an 'entitlement' close: a module the
 * tenant switched off itself stays off.
 */
export const CLOSED_REASONS = ['entitlement', 'policy', 'retired'] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

/**
 * Platform-wide availability of a tenant-installable module (03):
 *   available  listed; tenants install it themselves (plan rules apply)
 *   unlisted   not listed; arrives only with a plan, from the operator or the default list
 *   hidden     not listed, no new installs or reactivation; installed copies keep running
 *   retired    not listed, closed on every tenant (data kept)
 */
export const AVAILABILITY_STATES = ['available', 'unlisted', 'hidden', 'retired'] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** Per-tenant operator policy (04). Only 'block' exists; an absent row means no policy. */
export const MODULE_POLICIES = ['block'] as const;
export type ModulePolicyKind = (typeof MODULE_POLICIES)[number];
