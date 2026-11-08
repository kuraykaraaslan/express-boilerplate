/**
 * Audit and rate limit of the MCP surface (phase 20.1). Every `tools/call` is recorded: through the optional `audit_log` module when it is
 * active for the key's tenant, through the logger otherwise. A row carries the tool, the outcome, the duration and the argument NAMES; it
 * never carries argument values or results (both can be free text written by someone else).
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import Logger from '@kuraykaraaslan-labs/logger';
import type { ToolCallRecord } from './mcp.protocol';
import type { McpPrincipal } from './mcp.types';

export type McpAuditSink = (principal: McpPrincipal, rec: ToolCallRecord) => Promise<void>;

export const auditToolCall: McpAuditSink = async (principal, rec) => {
  const line = `[mcp] tenant=${principal.tenantId} key=${principal.apiKeyId} tool=${rec.tool} kind=${rec.kind} outcome=${rec.outcome} ms=${rec.durationMs}`;
  try {
    const mod = await ifActive(principal.tenantId, 'audit_log', () => import('@kuraykaraaslan-labs/audit_log/server/audit_log.service'));
    if (!mod) { Logger.info(line); return; }
    await mod.default.log({
      tenantId: principal.tenantId, actorId: principal.apiKeyId, actorType: 'API_KEY', action: `observability.mcp.${rec.kind === 'write' ? 'write' : 'read'}`,
      severity: rec.kind === 'write' || rec.outcome === 'denied' ? 'medium' : 'low', resourceType: rec.target?.type ?? 'mcp_tool', resourceId: rec.target?.id ?? null,
      metadata: { tool: rec.tool, outcome: rec.outcome, durationMs: rec.durationMs, argKeys: rec.argKeys, ...(rec.code ? { code: rec.code } : {}) },
    });
  } catch (e) {
    Logger.warn(`${line} (audit_log failed: ${e instanceof Error ? e.message : String(e)})`);
  }
};

export interface McpLimits {
  /** Throws an `AppError` 429 when this key has used its budget for the kind of call. */
  admit(principal: McpPrincipal, kind: 'read' | 'write'): Promise<void>;
}

export interface DefaultMcpLimitOptions { readPerMinute?: number; writePerMinute?: number }

/** Per KEY (not per tenant, not per IP): one noisy agent cannot starve another key of the same workspace. Fixed window through the shared limiter. */
export class DefaultMcpLimits implements McpLimits {
  private readonly read: number;
  private readonly write: number;
  constructor(o: DefaultMcpLimitOptions = {}) { this.read = o.readPerMinute ?? 120; this.write = o.writePerMinute ?? 20; }

  async admit(principal: McpPrincipal, kind: 'read' | 'write'): Promise<void> {
    const { check } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service');
    const res = await check(`mcp:${principal.apiKeyId}:${kind}`, 'api', { limit: kind === 'write' ? this.write : this.read, tenantId: principal.tenantId });
    if (!res.success) throw new AppError('MCP rate limit exceeded for this key', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: true, headers: { 'Retry-After': String(res.retryAfter) } });
  }
}
