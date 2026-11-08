import type { AuthzRequest, Decision, Explanation, Policy, PolicyRule, PolicyTrace } from './auth_abac.types';
import { ATTRIBUTE_ROOTS, type AbacOperator } from './auth_abac.enums';
import { boundedRegexTest } from './auth_abac.regex';
import { ABAC_SETTINGS_DEFAULTS } from './auth_abac.setting.keys';

/** Knobs the PDP passes down from the tenant settings; every field has a safe default. */
export interface EvalOptions {
  /** Wall-clock budget for one `regex` rule match that the static ReDoS check did not clear. */
  regexTimeoutMs?: number;
}

// Keys that must never be traversed via a rule's dotted path — blocks
// prototype-pollution reads (`subject.__proto__.x`).
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Safely resolve a rule's dotted `attribute` path against the request. The
 * first segment must be one of the allow-listed roots (subject/resource/
 * environment) or the bare `action`; every subsequent segment is checked with
 * `Object.hasOwn` and rejected if it names a dangerous prototype key. Returns
 * `undefined` for any path that does not resolve to an own property.
 */
export function resolveAttribute(req: AuthzRequest, path: string): unknown {
  if (path === 'action') return req.action;
  const segments = path.split('.');
  const root = segments[0];
  if (!(ATTRIBUTE_ROOTS as readonly string[]).includes(root)) return undefined;
  if (root === 'action') return req.action;

  let current: unknown = (req as unknown as Record<string, unknown>)[root];
  for (const seg of segments.slice(1)) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (FORBIDDEN_SEGMENTS.has(seg)) return undefined;
    if (!Object.hasOwn(current as object, seg)) return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function attrToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function firstValue(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

/** Whether a single policy rule holds for the request. */
export function ruleMatches(rule: PolicyRule, req: AuthzRequest, opts: EvalOptions = {}): boolean {
  const raw = resolveAttribute(req, rule.attribute);
  const operator: AbacOperator = rule.operator;

  // `exists` tests presence, independent of a target value.
  if (operator === 'exists') return raw !== undefined && raw !== null && raw !== '';

  const actual = attrToString(raw);

  switch (operator) {
    case 'eq':
      return actual === firstValue(rule.value);
    case 'neq':
      return actual !== firstValue(rule.value);
    case 'in':
      return asList(rule.value).includes(actual);
    case 'nin':
      return !asList(rule.value).includes(actual);
    case 'contains':
      return asList(rule.value).some((v) => actual.includes(v));
    case 'dnEquals':
      // Match one RDN (e.g. "CN=App-Admins") anywhere in a DN string.
      return actual
        .split(',')
        .some((rdn) => rdn.trim().toLowerCase() === firstValue(rule.value).toLowerCase());
    case 'regex':
      return boundedRegexTest(
        firstValue(rule.value),
        actual,
        opts.regexTimeoutMs ?? ABAC_SETTINGS_DEFAULTS.regexTimeoutMs,
      );
    case 'gt': {
      const a = toNumber(raw);
      const b = toNumber(firstValue(rule.value));
      return a !== null && b !== null && a > b;
    }
    case 'lt': {
      const a = toNumber(raw);
      const b = toNumber(firstValue(rule.value));
      return a !== null && b !== null && a < b;
    }
    default:
      return false;
  }
}

/** Whether a policy's target covers the request. Empty arrays match everything. */
export function policyMatchesTarget(policy: Policy, req: AuthzRequest): boolean {
  const { resourceTypes, actions } = policy.target;
  if (resourceTypes.length > 0 && !resourceTypes.includes(req.resource.type)) return false;
  if (actions.length > 0 && !actions.includes(req.action)) return false;
  return true;
}

const NEGATIVE_OPERATORS: ReadonlySet<AbacOperator> = new Set<AbacOperator>(['neq', 'nin']);

/**
 * auth_abac.02 (b): a negative operator (`neq`, `nin`) on an ABSENT attribute says nothing about the subject. In a PERMIT it
 * no longer matches (a permit that matches on missing data is fail-open); in a DENY it still matches (fail closed).
 */
function ruleHoldsFor(rule: PolicyRule, req: AuthzRequest, opts: EvalOptions, effect: Policy['effect']): boolean {
  if (effect === 'permit' && NEGATIVE_OPERATORS.has(rule.operator)) {
    const raw = resolveAttribute(req, rule.attribute);
    if (raw === undefined || raw === null || raw === '') return false;
  }
  return ruleMatches(rule, req, opts);
}

/** Whether a policy applies AND all its rules (AND-ed) hold. */
function policyMatches(policy: Policy, req: AuthzRequest, opts: EvalOptions): boolean {
  if (!policyMatchesTarget(policy, req)) return false;
  return (policy.rules ?? []).every((rule) => ruleHoldsFor(rule, req, opts, policy.effect));
}

/**
 * Evaluate an ordered (priority ASC) policy-set under deny-overrides:
 *   1. the first matching `deny` short-circuits → explicit_deny
 *   2. otherwise the first matching `permit` → policy_permit
 *   3. nothing matched → not_applicable (the PDP then tries RBAC fallback)
 * Pure: no I/O, fully unit-testable.
 */
export function evaluatePolicies(policies: Policy[], req: AuthzRequest, opts: EvalOptions = {}): Decision {
  let firstPermit: Policy | undefined;
  for (const policy of policies) {
    if (!policyMatches(policy, req, opts)) continue;
    if (policy.effect === 'deny') {
      return { effect: 'deny', policyId: policy.policyId, reason: 'explicit_deny' };
    }
    if (!firstPermit) firstPermit = policy;
  }
  if (firstPermit) {
    return { effect: 'permit', policyId: firstPermit.policyId, reason: 'policy_permit' };
  }
  return { effect: 'deny', reason: 'not_applicable' };
}

/**
 * Same evaluation as {@link evaluatePolicies} but returns a per-policy trace for
 * the simulator: which policies matched their target, which rules held, and
 * which policy actually decided the result.
 */
export function explain(policies: Policy[], req: AuthzRequest, opts: EvalOptions = {}): Explanation {
  const decision = evaluatePolicies(policies, req, opts);
  const trace: PolicyTrace[] = policies.map((policy) => {
    const matchedTarget = policyMatchesTarget(policy, req);
    const matchedRules = matchedTarget
      ? (policy.rules ?? []).filter((rule) => ruleMatches(rule, req, opts)).map((r) => r.attribute)
      : [];
    return {
      policyId: policy.policyId,
      name: policy.name,
      effect: policy.effect,
      matchedTarget,
      matchedRules,
      contributed: decision.policyId === policy.policyId,
    };
  });
  return { decision, trace };
}
