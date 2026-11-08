import { createHash } from 'node:crypto';
import { rolesVersionKey } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.keys';
import {
  noDropPending, openEntry, readGuarded, stampForWrite, stampOf, writeGuarded, type GuardedRead,
} from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { policiesVersionKey } from './auth_abac.cache-keys';
import type { AuthzRequest, Decision } from './auth_abac.types';

// Decisions are short-lived cache targets: the same (subject.id, action,
// resource, environment) tuple recurs across a burst of requests but policies
// may change at any time, so we keep the TTL short. Off unless a caller asks for it (`cache: true`).
const DECISION_TTL_SECONDS = 30;

/**
 * Deterministic cache key for a decision. Only stable, non-PII fields go into
 * the hash: the subject *id* (never email/PII), its role and resolved permissions (a group taken away changes the key, D253), the
 * action, and the full resource + environment bags. Time-varying environment attributes (e.g.
 * `now`) make the key miss — callers with such policies must disable caching.
 */
export function decisionKey(tenantId: string, req: AuthzRequest): string {
  const permissions = Array.isArray(req.subject.permissions) ? [...(req.subject.permissions as unknown[])].map(String).sort() : null;
  const material = JSON.stringify({
    action: req.action,
    resource: req.resource,
    environment: req.environment,
    subjectId: req.subject.id ?? null,
    role: req.subject.role ?? null,
    permissions,
    // How the caller signed in (FID-08): one person's passkey session and password session are different subjects to a policy on
    // `subject.amr`/`subject.acr`, so a permit cached for the first must never answer the second.
    amr: req.subject.amr ?? null,
    acr: req.subject.acr ?? null,
  });
  const digest = createHash('sha256').update(material).digest('hex');
  return `abac_decision:${tenantId}:${digest}`;
}

/**
 * The versions a cached decision depends on (D253): the tenant's policy set and its role set. A policy write or a role-set write bumps
 * its version in a cache-drop order recorded in the write's own transaction, which retires every cached decision of the tenant at once
 * on every node (the decisions cannot be listed to be deleted one by one).
 */
const versionKeys = (tenantId: string) => [policiesVersionKey(tenantId), rolesVersionKey(tenantId)];

/** The read each `getCached` made, for the `setCached` of the same request (the refill is sealed with what was read BEFORE deciding). */
const reads = new WeakMap<AuthzRequest, GuardedRead | null>();

/**
 * The cached decision, or null. Believed only when sealed with the stamp of this read (session_end.cache-guard.ts: the Redis instance,
 * the policy and role versions) and no cache drop is pending for the tenant.
 */
export async function getCached(tenantId: string, req: AuthzRequest): Promise<Decision | null> {
  const read = await readGuarded([decisionKey(tenantId, req)], versionKeys(tenantId));
  reads.set(req, read);
  const sealed = openEntry(read?.values[0], stampOf(read));
  if (!sealed || typeof sealed !== 'object' || Array.isArray(sealed)) return null;
  const d = sealed as Partial<Decision>;
  if (d.effect !== 'permit' && d.effect !== 'deny') return null;
  if (!(await noDropPending(tenantId))) return null;
  return sealed as Decision;
}

/** Caches `decision` sealed with the stamp `getCached` read for this request; nothing without one (or while Redis is untrusted). */
export async function setCached(
  tenantId: string,
  req: AuthzRequest,
  decision: Decision,
): Promise<void> {
  const read = reads.get(req) ?? null;
  reads.delete(req);
  const stamp = await stampForWrite(read);
  if (!stamp || !(await noDropPending(tenantId))) return;
  await writeGuarded(decisionKey(tenantId, req), stamp, decision, DECISION_TTL_SECONDS);
}
