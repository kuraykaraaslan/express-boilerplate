import { z } from 'zod';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { PolicyRuleSchema, PolicyTargetSchema } from './auth_abac.types';
import { PolicyEffectEnum } from './auth_abac.enums';
import { assessRegex } from './auth_abac.regex';

// A `regex` rule is user-authored code that runs on every matching request, so a
// pattern that can backtrack catastrophically is refused at write time.
const RulesSchema = z.array(PolicyRuleSchema).max(50).superRefine((rules, ctx) => {
  rules.forEach((rule, index) => {
    if (rule.operator !== 'regex') return;
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    for (const pattern of values) {
      const verdict = assessRegex(pattern);
      if (!verdict.ok) {
        ctx.addIssue({ code: 'custom', path: [index, 'value'], message: `Unsafe regex: ${verdict.reason}` });
        return;
      }
    }
  });
});

export const CreatePolicyDTO = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  effect: PolicyEffectEnum,
  priority: z.number().int().min(0).max(10000).default(100),
  isActive: z.boolean().default(true),
  target: PolicyTargetSchema.default({ resourceTypes: [], actions: [] }),
  rules: RulesSchema.default([]),
});

export const UpdatePolicyDTO = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  effect: PolicyEffectEnum.optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
  target: PolicyTargetSchema.optional(),
  rules: RulesSchema.optional(),
});

/** The policy columns the list can sort by (public field → entity property). */
export const POLICY_SORTABLE = {
  priority: 'priority',
  name: 'name',
  effect: 'effect',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

export const ListPoliciesQuery = listQuerySchema({
  sortable: POLICY_SORTABLE,
  // evaluation order first, as the list always read
  defaultSort: 'priority:asc,name:asc',
  pageSize: { default: 50, max: 200 },
  filters: { effect: listFilter.oneOf(PolicyEffectEnum.options), isActive: listFilter.flag() },
});

// One attribute namespace as supplied to the simulator (free-form bag).
const AttributeBagSchema = z.record(z.string(), z.unknown());

/** Dry-run a decision without persisting — the simulator's request body. */
export const SimulateDTO = z.object({
  subject: AttributeBagSchema.default({}),
  action: z.string().min(1).max(128),
  resource: z
    .object({ type: z.string().min(1).max(128) })
    .catchall(z.unknown()),
  environment: AttributeBagSchema.default({}),
  fallbackRole: z.enum(['OWNER', 'ADMIN', 'USER']).optional(),
});

export type CreatePolicyInput = z.infer<typeof CreatePolicyDTO>;
export type UpdatePolicyInput = z.infer<typeof UpdatePolicyDTO>;
export type ListPoliciesQueryInput = z.infer<typeof ListPoliciesQuery>;
export type SimulateInput = z.infer<typeof SimulateDTO>;
