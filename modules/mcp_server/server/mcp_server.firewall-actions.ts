/**
 * mcp_server's action for the AI firewall (`ai_firewall:action`, docs/phases/57-mcp-server D57-11): suspend one OAuth grant (an AI app's
 * connection of one person) for a while; the undo resumes it. The grant is a machine actor on its own lane (machine-mcp), acted on per
 * grant, never per address or person (FWA-6). Revoking for good stays a person's act on the Connected apps page (it has no undo, FWA-4).
 * An API key on MCP is acted on through api_key's own actions. Only the contract from common is imported at load.
 *
 * Add, never subtract (FWA-2): a grant already suspended or revoked is left as it is; the undo resumes only a suspension this run made
 * (its `suspendedUntil` must still be the one it wrote).
 */
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { firewallStep, undoText, type FirewallActionContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
const tenantOf = (tenantId: string | null): string => tenantId ?? ROOT_TENANT_ID;
const store = async () => (await import('./oauth/mcp_oauth.store')).oauthStore;
const audit = async () => (await import('./oauth/mcp_oauth.service')).defaultOauthDeps.audit;

export const SUSPEND_GRANT: FirewallActionContribution = {
  id: 'mcp_server.suspend_grant',
  rung: 'ban',
  lanes: ['machine-mcp'],
  actorKinds: ['session'],
  ttl: { defaultMs: 24 * HOUR_MS, maxMs: 7 * 24 * HOUR_MS },
  // An AI app of a person stops working: a person approves every run.
  minimumMode: 'suggest',
  hourlyBudget: 10,
  // Only the grant's own calls and refusals (its rows are keyed on the grant), never what others do in the person's name.
  evidence: { boundToActor: true, minSignals: 2 },
  execute: (ctx) => firewallStep(async () => {
    const tenantId = tenantOf(ctx.tenantId);
    const grantId = ctx.actor.id;
    const s = await store();
    const grant = await s.grantById(tenantId, grantId);
    if (!grant) return { status: 'noop', reason: 'no_such_grant' };
    if (grant.status !== 'active') return { status: 'noop', reason: `already_${grant.status}` };
    const until = new Date(Date.now() + Math.max(60_000, Math.min(7 * 24 * HOUR_MS, ctx.ttlMs)));
    if (!(await s.setStatus(tenantId, grantId, { status: 'suspended', suspendedUntil: until }))) return { status: 'noop', reason: 'not_active' };
    await (await audit())(tenantId, { action: 'mcp_server.grant.suspended', actorId: null, actorType: 'SYSTEM', grantId, severity: 'medium', metadata: { reason: `firewall:${ctx.reason}`, lane: 'machine-mcp' } });
    return { status: 'executed', undoData: { grantId, suspendedUntil: until.toISOString() }, expiresAt: until.toISOString() };
  }),
  undo: (ctx) => firewallStep(async () => {
    const tenantId = tenantOf(ctx.tenantId);
    const grantId = undoText(ctx.undoData, 'grantId');
    const until = undoText(ctx.undoData, 'suspendedUntil');
    if (!grantId || !until) return { status: 'noop', reason: 'no_undo_data' };
    const s = await store();
    const grant = await s.grantById(tenantId, grantId);
    if (!grant || grant.status !== 'suspended') return { status: 'noop', reason: 'not_suspended' };
    if (grant.suspendedUntil?.toISOString() !== until) return { status: 'noop', reason: 'superseded' };
    if (!(await s.setStatus(tenantId, grantId, { status: 'active' }))) return { status: 'noop', reason: 'not_suspended' };
    await (await audit())(tenantId, { action: 'mcp_server.grant.resumed', actorId: null, actorType: 'SYSTEM', grantId, severity: 'low', metadata: { reason: 'firewall:undo', lane: 'machine-mcp' } });
    return { status: 'executed' };
  }),
};

const ACTIONS: FirewallActionContribution[] = [SUSPEND_GRANT];

export default ACTIONS;
