// events: structured log + scoped audit.
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import Logger from '@kuraykaraaslan-labs/logger';
import type { Json } from '../../../sdk/types';
import { pluginNamespace, type BrokerCtx } from '../broker.context';

/** common.10: the largest audit payload a plugin emits, serialised (16 KiB): the audit log is not a blob store. */
export const PLUGIN_EVENT_MAX_PAYLOAD_BYTES = 16 * 1024;

const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/g;
function oneLine(text: string): string {
  return text.replace(CONTROL_RE, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

export const events = {
  async log(ctx: BrokerCtx, level: 'info' | 'warn' | 'error', message: string, meta?: Json): Promise<Json> {
    // logger.02: a plugin's message is ONE log line. CR, LF, the Unicode line separators and other control characters are
    // written escaped, so a plugin cannot forge a platform line after its own.
    const line = `[plugin:${ctx.pluginId}] ${oneLine(String(message))}`;
    if (level === 'error') Logger.error(line, meta as object);
    else if (level === 'warn') Logger.warn(line, meta as object);
    else Logger.info(line, meta as object);
    // The publisher's own view of this (marketplace 6D): a capped per-plugin tail in
    // observability. Dynamic + fire-and-forget like the execution report — telemetry
    // being down must never fail a plugin's log call. Optional (EXT-14) and not gated:
    // it is the platform's telemetry, not a tenant feature.
    void import('@kuraykaraaslan-labs/observability/server/observability.plugin-stats')
      .then((m) => m.recordPluginLog(ctx.pluginId, level, String(message)))
      .catch(() => { /* observability absent/broken → logging is unaffected */ });
    return null;
  },
  async emit(ctx: BrokerCtx, event: string, payload: Json): Promise<Json> {
    const size = Buffer.byteLength(JSON.stringify(payload ?? null) ?? 'null', 'utf8');
    if (size > PLUGIN_EVENT_MAX_PAYLOAD_BYTES) throw new Error(`event payload too large: at most ${PLUGIN_EVENT_MAX_PAYLOAD_BYTES} bytes serialised`);
    const name = String(event ?? '');
    if (name.length > 128) throw new Error('invalid event name: at most 128 characters');
    await AuditLogService.log({
      tenantId: ctx.tenantId,
      actorId: null,
      action: `plugin.${pluginNamespace(ctx.pluginId, '.')}.${String(event)}`,
      resourceType: 'plugin_event',
      resourceId: ctx.pluginId,
      metadata: { payload } as Record<string, unknown>,
    });
    return null;
  },
};
