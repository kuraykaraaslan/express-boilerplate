/**
 * Record-scope inventory (docs/phases/38-security/06 6.4). Within a tenant, who may see WHICH record is constrained only in the modules that adopted
 * `VisibilityService` (own / team / all, the CRM-style record scope). Everywhere else "tenant-wide by design" and "coarse by omission" look the same.
 * This list makes the difference explicit for every module whose entities carry an owner or assignee column:
 *
 *  - uses `VisibilityService` (computed from the source, never declared here): record-scoped;
 *  - `TENANT_WIDE_BY_DESIGN`: every member holding the permission sees every record, and the reason says why that is right;
 *  - `UNREVIEWED`: not yet decided. Grandfathered, and the list only SHRINKS: a module leaves it by adopting VisibilityService or by gaining a reason.
 *
 * `auth_abac.record-scope.inventory.test.ts` fails on a new module with an owner column that is in none of the three, and on a stale entry.
 */
export const TENANT_WIDE_BY_DESIGN: Readonly<Record<string, string>> = {
  announcement: 'announcements are the workspace\'s (or the platform\'s) messages to its members, managed by holders of the announcement permissions; createdByUserId records the sender, not who may see one',
  api_key: 'API keys are tenant configuration managed by holders of the api-key permissions; the owner column records who created a key, not who may see it',
  feature_flags: 'flags and experiments are tenant configuration; every holder of the feature-flag permissions sees all of them',
  tenant_branding: 'branding is one tenant-wide configuration; the author column is provenance only',
  tenant_member: 'the member list is tenant-wide by definition (the people of the workspace); visibility of a member is not record-scoped',
  tenant: 'the tenant row and its settings are the workspace itself',
  webhook: 'webhooks are tenant integration configuration managed by holders of the webhook permissions',
  observability: 'monitors, alerts and status pages are shared operational configuration of the workspace',
  fleet: 'fleet control-plane entities are platform operator data, not per-user records of a tenant',
  fleet_directory: 'fleet control-plane entities are platform operator data, not per-user records of a tenant',
  fleet_release: 'fleet control-plane entities are platform operator data, not per-user records of a tenant',
  utm: 'campaign parameters are shared marketing configuration of the workspace',
};

/** Modules with an owner / assignee column that have not been classified yet. Shrink-only. */
export const UNREVIEWED: readonly string[] = [
  'bank', 'bookings', 'calendar', 'contract', 'crm_assignment', 'crm_lead_finder', 'dashboard', 'data_import', 'document', 'drive', 'events',
  'field_service', 'hr', 'hr_attendance', 'hr_contract', 'hr_leave', 'hr_recruitment', 'messaging', 'pos', 'project', 'telephony', 'wallet',
];
