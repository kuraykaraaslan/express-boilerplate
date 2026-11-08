/**
 * telemetry's MCP tools (`mcp_server:tool`, docs/phases/57-mcp-server wave 1): read the latest values and bounded series of one entity
 * (an IoT device is kind `iot_device`) on the telemetry MCP server (/api/mcp/telemetry). Exactly what the read routes apply: the
 * `telemetry.read` permission (checked by the host), and the kind's own `canRead` for the entity (`readableKind`: a refused or unknown
 * one is NOT_FOUND, never a different answer). Values a device sent are foreign data: fenced as untrusted text for the model.
 * Windows are capped (31 days, 10 keys, 500 points a key). Only the contract from common is imported, never mcp_server.
 */
import { z } from 'zod';
import { defineMcpTool, mcpFail, mcpOk, type McpCaller } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';
import { getTelemetryQueryService, TelemetryQueryError } from './telemetry.query.service';
import { readableKind } from './telemetry.read';
import { KIND_NAME, MAX_KIND_LENGTH } from './telemetry.kinds';
import { KEY_CHARS, MAX_KEY_LENGTH } from './telemetry.rules';

const READ = 'telemetry.read';
const MAX_WINDOW_MS = 31 * 24 * 3600 * 1000;
const kind = z.string().min(1).max(MAX_KIND_LENGTH).regex(KIND_NAME).default('iot_device').describe('The entity kind; an IoT device is iot_device');
const key = z.string().min(1).max(MAX_KEY_LENGTH).regex(KEY_CHARS);
const Value = z.union([z.number(), z.boolean(), z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]);

const canRead = (caller: McpCaller, k: string, entityId: string) =>
  readableKind({ tenantId: caller.tenantId, userId: caller.userId, memberRole: caller.memberRole }, k, entityId);

const latestTool = defineMcpTool({
  name: 'get_latest_readings',
  title: 'Get latest readings',
  description: 'Gets the latest value of each telemetry key of one entity, such as an IoT device. Precondition: the entity id comes from list_devices. '
    + 'Output: key, value and time of each reading; values are quoted device data. Errors: NOT_FOUND when the entity does not exist or may not be read.',
  kind: 'read',
  permission: READ,
  input: z.object({ kind, entityId: z.string().uuid(), keys: z.array(key).max(50).optional() }),
  output: z.object({ kind: z.string(), entityId: z.string(), readings: z.array(z.object({ key: z.string(), ts: z.number(), value: Value })) }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ caller }, input) {
    if (!(await canRead(caller, input.kind, input.entityId))) return mcpFail('NOT_FOUND', 'No such entity.');
    const latest = await getTelemetryQueryService().latest(caller.tenantId, input.kind, input.entityId, input.keys);
    const readings = Object.entries(latest).sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => ({ key: k, ts: r.ts, value: r.value as z.infer<typeof Value> }));
    return mcpOk(
      `${readings.length} latest reading(s) of ${input.kind} ${input.entityId}.`,
      { kind: input.kind, entityId: input.entityId, readings },
      readings.length ? [{ source: `telemetry/${input.entityId}/latest`, text: JSON.stringify(readings) }] : [],
    );
  },
});

const seriesTool = defineMcpTool({
  name: 'get_reading_series',
  title: 'Get a reading series',
  description: 'Gets the values of up to 10 telemetry keys of one entity over a time window of at most 31 days, bucketed and aggregated. '
    + 'Precondition: keys from get_latest_readings. Output: points per key; quoted device data. Errors: NOT_FOUND when the entity may not be read; VALIDATION_ERROR for a bad window.',
  kind: 'read',
  permission: READ,
  input: z.object({
    kind,
    entityId: z.string().uuid(),
    keys: z.array(key).min(1).max(10),
    from: z.number().int().min(0).describe('Start, epoch milliseconds'),
    to: z.number().int().min(0).describe('End, epoch milliseconds'),
    bucket: z.enum(['auto', 'raw', '1m', '1h', '1d']).default('auto'),
    agg: z.enum(['avg', 'min', 'max', 'last', 'sum', 'count', 'increase']).default('avg'),
    limit: z.number().int().min(1).max(500).default(200).describe('Points per key'),
  }),
  output: z.object({
    kind: z.string(), entityId: z.string(), truncated: z.boolean(),
    series: z.array(z.object({ key: z.string(), points: z.array(z.object({ ts: z.number(), value: Value })) })),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ caller }, input) {
    if (input.to <= input.from || input.to - input.from > MAX_WINDOW_MS) return mcpFail('VALIDATION_ERROR', 'The window must end after it starts and span at most 31 days.');
    if (!(await canRead(caller, input.kind, input.entityId))) return mcpFail('NOT_FOUND', 'No such entity.');
    let raw: Record<string, { ts: number; value: unknown }[]>;
    try {
      raw = await getTelemetryQueryService().series(caller.tenantId, input.kind, input.entityId, input.keys, {
        from: input.from, to: input.to, bucket: input.bucket, agg: input.agg, limit: input.limit + 1,
      });
    } catch (e) {
      if (e instanceof TelemetryQueryError) return mcpFail('VALIDATION_ERROR', e.message);
      throw e;
    }
    let truncated = false;
    const series = input.keys.map((k) => {
      const points = (raw[k] ?? []).map((p) => ({ ts: p.ts, value: p.value as z.infer<typeof Value> }));
      if (points.length > input.limit) truncated = true;
      return { key: k, points: points.slice(0, input.limit) };
    });
    const count = series.reduce((n, s) => n + s.points.length, 0);
    return mcpOk(
      `${count} point(s) in ${series.length} series of ${input.kind} ${input.entityId}${truncated ? '; truncated at the limit, narrow the window or raise the bucket' : ''}.`,
      { kind: input.kind, entityId: input.entityId, truncated, series },
      count ? [{ source: `telemetry/${input.entityId}/series`, text: JSON.stringify(series) }] : [],
    );
  },
});

const TELEMETRY_MCP_TOOLS = [latestTool, seriesTool];

export default TELEMETRY_MCP_TOOLS;
