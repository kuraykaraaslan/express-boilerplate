/**
 * The production dependencies of a tool call: the limiter (per credential and kind, fail closed: LANE_POLICY's machine lanes) and the
 * audit row (docs/phases/57-mcp-server D57-10, D57-11). The audit row's action is a registered firewall signal kind
 * (mcp_server.firewall-signals): the firewall sees every MCP call through its audit sink.
 */
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import type { McpCaller } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';
import Logger from '@kuraykaraaslan-labs/logger';
import { IDEMPOTENCY_KEY_TTL, MCP_READ_PER_MINUTE, MCP_WRITE_PER_MINUTE } from './mcp_server.protocol';
import type { IdempotencyStore, ShapedResult, ToolCallDeps, ToolCallRecord } from './mcp_server.register';

export const MCP_TOOL_CALLED = 'mcp_server.tool.called';
export const MCP_TOOL_REFUSED = 'mcp_server.tool.refused';

/** The audit action of a record: a call that ran (ok or a tool error), or one the host refused (denied, rate limited). */
export function auditActionOf(rec: Pick<ToolCallRecord, 'outcome'>): string {
  return rec.outcome === 'denied' || rec.outcome === 'rate_limited' ? MCP_TOOL_REFUSED : MCP_TOOL_CALLED;
}

export async function auditToolCall(caller: McpCaller, rec: ToolCallRecord): Promise<void> {
  const line = `[mcp] tenant=${caller.tenantId} ${caller.via}=${caller.credentialId} server=${rec.moduleId} tool=${rec.tool} outcome=${rec.outcome} ms=${rec.durationMs}`;
  try {
    const mod = await ifActive(caller.tenantId, 'audit_log', () => import('@kuraykaraaslan-labs/audit_log/server/audit_log.service'));
    if (!mod) { Logger.info(line); return; }
    const refused = auditActionOf(rec) === MCP_TOOL_REFUSED;
    // A key's call is the key's row (lane machine-apikey). An OAuth grant's call is an actorless SERVICE row that names the grant: the
    // firewall weighs it against the grant (`systemRowActor`, a `session`) on lane machine-mcp, never against the person or an address.
    const viaKey = caller.via === 'api_key';
    await mod.default.log({
      tenantId: caller.tenantId,
      actorId: viaKey ? caller.credentialId : null,
      actorType: viaKey ? 'API_KEY' : 'SERVICE',
      action: refused ? MCP_TOOL_REFUSED : MCP_TOOL_CALLED,
      severity: refused || rec.outcome === 'timeout' || rec.kind === 'write' ? 'medium' : 'low',
      resourceType: 'mcp_tool',
      resourceId: null,
      metadata: {
        surface: 'mcp', server: rec.moduleId, tool: rec.tool, kind: rec.kind, outcome: rec.outcome, durationMs: rec.durationMs,
        argKeys: rec.argKeys, holderUserId: caller.userId, ...(rec.code ? { code: rec.code } : {}),
        ...(viaKey ? {} : { grantId: caller.credentialId, lane: 'machine-mcp' }),
      },
    });
  } catch (e) {
    Logger.warn(`${line} (audit_log failed: ${e instanceof Error ? e.message : String(e)})`);
  }
}

/** Per credential, not per tenant or address: one noisy agent cannot starve another credential of the same workspace. */
export async function admitToolCall(caller: McpCaller, kind: 'read' | 'write'): Promise<boolean> {
  const { check } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service');
  const res = await check(`mcp:${caller.via}:${caller.credentialId}:${kind}`, 'api', {
    limit: kind === 'write' ? MCP_WRITE_PER_MINUTE : MCP_READ_PER_MINUTE, tenantId: caller.tenantId, failMode: 'closed',
  });
  return res.success;
}

/** Redis-backed idempotency (gate R1), SET NX with the house TTL; fails closed (the caller refuses on a throw). */
export const redisIdempotency: IdempotencyStore = {
  async reserve(key) {
    const redis = (await import('@kuraykaraaslan-labs/redis')).default;
    const first = await redis.set(key, 'pending', 'EX', IDEMPOTENCY_KEY_TTL, 'NX');
    if (first === 'OK') return 'reserved';
    const held = await redis.get(key);
    if (!held || held === 'pending') return 'pending';
    try { return { result: JSON.parse(held) as ShapedResult }; } catch { return 'pending'; }
  },
  async complete(key, result) {
    const redis = (await import('@kuraykaraaslan-labs/redis')).default;
    await redis.set(key, JSON.stringify(result), 'EX', IDEMPOTENCY_KEY_TTL);
  },
  async release(key) {
    const redis = (await import('@kuraykaraaslan-labs/redis')).default;
    await redis.del(key);
  },
};

export const defaultToolCallDeps: ToolCallDeps = {
  idempotency: redisIdempotency,
  admit: admitToolCall,
  audit: auditToolCall,
  report: (error, rec) => Logger.error(`[mcp] ${rec.moduleId}/${rec.tool} failed: ${error instanceof Error ? error.message : String(error)}`),
};
