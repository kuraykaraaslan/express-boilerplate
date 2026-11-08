import type { PolicyRule, PolicyTarget } from './auth_abac.types';

/**
 * Ready-made example policies. Pure data (no I/O) so both the tenant seed
 * (`auth_abac.seed.ts`) and the admin UI ("Load examples" on the empty Access
 * Policies screen) share one source of truth.
 *
 * The first two mirror the phase-5 dynamic_page pilot actions; the next two are
 * the CRM record guardrails (terminal deal, converted lead); the rest are
 * inactive templates showing numeric and subject-attribute matching.
 *
 * **Every ACTIVE policy here reads `resource.*`, and that only works because a
 * route feeds it.** Until 2026-08-19 nothing did: `authorizeRequest` accepts a
 * `resource` bag but cannot fill one (it runs before the row is loaded, which is
 * the right order), so a sweep found zero production call sites supplying one
 * and these policies could never match. `authorizeResource`
 * (`auth_abac.resource.next.ts`) is the second pass that closed that, and the
 * CRM routes are its first callers. A policy added here that names an attribute
 * no route supplies is decoration — check the feeder before adding one.
 */
export interface ExamplePolicy {
  name: string;
  description: string;
  effect: 'permit' | 'deny';
  priority: number;
  isActive: boolean;
  target: PolicyTarget;
  rules: PolicyRule[];
}

export const EXAMPLE_POLICIES: ExamplePolicy[] = [
  {
    name: 'Only owners can edit published pages',
    description:
      'Deny updating a page while it is PUBLISHED unless the actor is an OWNER. Demonstrates resource + subject attribute matching (phase-5 dynamic_page pilot).',
    effect: 'deny',
    priority: 10,
    isActive: true,
    target: { resourceTypes: ['page'], actions: ['dynamic_page.page.update'] },
    rules: [
      { attribute: 'resource.status', operator: 'eq', value: 'PUBLISHED' },
      { attribute: 'subject.role', operator: 'neq', value: 'OWNER' },
    ],
  },
  {
    name: 'Only owners can delete published pages',
    description:
      'Deny deleting a PUBLISHED page unless the actor is an OWNER — a safety guardrail on the dynamic_page delete route.',
    effect: 'deny',
    priority: 11,
    isActive: true,
    target: { resourceTypes: ['page'], actions: ['dynamic_page.page.delete'] },
    rules: [
      { attribute: 'resource.status', operator: 'eq', value: 'PUBLISHED' },
      { attribute: 'subject.role', operator: 'neq', value: 'OWNER' },
    ],
  },
  {
    name: 'Only owners can reopen a closed deal',
    description:
      'Deny updating an opportunity that has reached WON or LOST unless the actor is an OWNER. '
      + 'A terminal deal is what every forecast, win-rate and stage-velocity report is computed from; '
      + 'letting anyone edit one silently rewrites history that has already been reported.',
    effect: 'deny',
    priority: 12,
    isActive: true,
    target: {
      resourceTypes: ['crm_opportunity.opportunities'],
      actions: ['crm_opportunity.opportunities.update'],
    },
    rules: [
      { attribute: 'resource.stage', operator: 'in', value: ['WON', 'LOST'] },
      { attribute: 'subject.role', operator: 'neq', value: 'OWNER' },
    ],
  },
  {
    name: 'Only owners can edit a converted lead',
    description:
      'Deny updating a lead once it has been CONVERTED unless the actor is an OWNER. '
      + 'After conversion the truth lives on the contact and the opportunity the lead produced; '
      + 'editing the lead afterwards makes the two disagree with no record of which came first.',
    effect: 'deny',
    priority: 13,
    isActive: true,
    target: {
      resourceTypes: ['crm_lead.leads'],
      actions: ['crm_lead.leads.update'],
    },
    rules: [
      { attribute: 'resource.status', operator: 'eq', value: 'CONVERTED' },
      { attribute: 'subject.role', operator: 'neq', value: 'OWNER' },
    ],
  },
  {
    name: 'Example — only admins may delete a deal above 100k (template)',
    description:
      'Inactive template showing a numeric threshold on a record attribute. Amounts are compared in '
      + 'MINOR units (kuruş/cents), so 100k TRY is 10000000 — the same unit the column stores, because '
      + 'a policy that quietly divided by 100 would be wrong for every zero-decimal currency.',
    effect: 'deny',
    priority: 14,
    isActive: false,
    target: {
      resourceTypes: ['crm_opportunity.opportunities'],
      actions: ['crm_opportunity.opportunities.delete'],
    },
    rules: [
      { attribute: 'resource.amountMinor', operator: 'gt', value: '10000000' },
      { attribute: 'subject.role', operator: 'nin', value: ['OWNER', 'ADMIN'] },
    ],
  },
  {
    name: 'Example — department-scoped access (template)',
    description:
      'Inactive template: permit only subjects in the Engineering department. Enable and adjust to gate any action by a subject attribute (needs user_profile.department).',
    effect: 'permit',
    priority: 100,
    isActive: false,
    target: { resourceTypes: [], actions: [] },
    rules: [{ attribute: 'subject.department', operator: 'eq', value: 'Engineering' }],
  },
];
