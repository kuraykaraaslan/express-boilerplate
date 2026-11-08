/**
 * The vocabulary of the MCP surface (phase 20.1): who is calling, what a tool is, and the data port the tools read through.
 *
 * `McpData` is a port so the tools are tested without a database and the security tests can prove that a tool only ever passes the
 * PRINCIPAL's tenant: every method takes `tenantId` first and a tool never gets a way to choose another one.
 */
import type { z } from 'zod';

export const MCP_READ_SCOPE = 'observability:mcp:read';
export const MCP_WRITE_SCOPE = 'observability:mcp:write';

export interface McpPrincipal {
  /** The tenant of the verified key. The only tenant any tool call may touch. */
  tenantId: string;
  apiKeyId: string;
  canRead: boolean;
  canWrite: boolean;
}

export type ToolKind = 'read' | 'write';

export interface ToolContext {
  tenantId: string;
  apiKeyId: string;
  data: McpData;
  now: Date;
}

export interface McpToolDefinition<I = unknown> {
  name: string;
  title: string;
  /** Always ends with the standing warning about untrusted data (added by the registry), so a tool author cannot forget it. */
  description: string;
  kind: ToolKind;
  input: z.ZodType<I>;
  /** Returns plain data. The registry sanitises it, wraps it in the untrusted envelope and applies the size budget. */
  run(ctx: ToolContext, args: I): Promise<unknown>;
  /** The audit row's resource, taken from the validated arguments (an id, never free text). */
  target?(args: I): { type: string; id: string } | null;
}

export interface MonitorView { monitorId: string; name: string; type: string; target: string; isActive: boolean; lastStatus: string; lastCheckedAt: string | null; intervalSeconds: number; groupName: string | null; tags: string[] }
export interface CheckView { status: string; latencyMs: number | null; statusCode: number | null; error: string | null; checkedAt: string; duringMaintenance: boolean }
export interface IncidentView { incidentId: string; title: string; status: string; severity: string; isAuto: boolean; monitorId: string | null; startedAt: string; resolvedAt: string | null; acknowledgedAt: string | null; mitigatedAt: string | null; reason: string | null }
export interface TimelineView { type: string; at: string; data: Record<string, unknown> | null }
export interface ChangeView { at: string; kind: string; title: string; actor: string | null; ref: string | null; source: string }
export interface AlertView { alertId: string; title: string; severity: string; status: string; source: string; startsAt: string; lastFiredAt: string; count: number; incidentId: string | null; acknowledgedAt: string | null; suppressedBy: string | null; labels: Record<string, string>; annotations: Record<string, string> }
export interface SloView { sloId: string; name: string; objectivePercent: number; windowDays: number; budget: unknown; currentBurn: number | null; projectedExhaustionDays: number | null; firing: boolean }
export interface OnCallView { scheduleId: string; name: string; userId: string | null; source: string | null; until: string | null }

export interface SilenceRequest { alertId: string; durationMinutes: number; reason: string }

/** Everything the tools read or write, for ONE tenant per call. */
export interface McpData {
  listMonitors(tenantId: string, opts: { limit: number }): Promise<MonitorView[]>;
  monitorChecks(tenantId: string, monitorId: string, limit: number): Promise<CheckView[] | null>;
  listIncidents(tenantId: string, opts: { status?: string; limit: number }): Promise<IncidentView[]>;
  getIncident(tenantId: string, incidentId: string): Promise<IncidentView | null>;
  incidentTimeline(tenantId: string, incidentId: string, limit: number): Promise<TimelineView[]>;
  incidentChanges(tenantId: string, incidentId: string, lookbackMinutes: number): Promise<{ from: string; to: string; items: ChangeView[] } | null>;
  listAlerts(tenantId: string, opts: { status?: string; severity?: string; limit: number }): Promise<AlertView[]>;
  getAlert(tenantId: string, alertId: string): Promise<AlertView | null>;
  sloStatus(tenantId: string, sloId?: string): Promise<SloView[]>;
  /** `null` when the on_call module is not installed or not active for the tenant. */
  onCall(tenantId: string): Promise<OnCallView[] | null>;
  queryLogs(tenantId: string, input: unknown): Promise<unknown>;
  queryTraces(tenantId: string, input: unknown): Promise<unknown>;
  queryMetrics(tenantId: string, input: unknown): Promise<unknown>;
  ackAlert(tenantId: string, alertId: string, keyId: string): Promise<{ alertId: string; acknowledgedAt: string | null }>;
  silenceAlert(tenantId: string, req: SilenceRequest, keyId: string): Promise<{ silenceId: string; endsAt: string; matchers: number }>;
  addIncidentNote(tenantId: string, incidentId: string, content: string, keyId: string): Promise<{ commentId: string }>;
}
