// Daily roll-up of sandboxed-plugin executions, so a publisher can SEE the crash
// and timeout rate of their listing in the product (marketplace roadmap §6D).
//
// Prometheus and Sentry (observability.service) stay the operator's surfaces;
// neither is queryable per listing from inside the product, and the marketplace
// must not grow a telemetry store of its own — so the platform's observability
// module keeps this small aggregate: one Redis hash per (plugin, UTC day) with
// four counters, expired after the longest window anyone is shown. No per-call
// rows, no tenant ids: the unit is the plugin, the numbers are cross-tenant
// counts. Best-effort by construction — recording never throws into the plugin
// call, and a Redis outage costs a day's resolution, not a failed run.

import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import type { PluginExecutionSample } from './observability.types';

/** Days a daily bucket is kept; also the longest window `getPluginExecutionStats` serves. */
export const PLUGIN_STATS_RETENTION_DAYS = 35;

const DAY_MS = 86_400_000;

const key = (pluginId: string, day: string): string => `observability:plugin-exec:${pluginId}:${day}`;
/**
 * The same four counters for ONE workspace's use of the plugin, so a workspace can see how the plugins it
 * runs behave for it. A separate key, so the cross-tenant roll-up the publisher reads never carries a tenant id.
 */
const tenantKey = (tenantId: string, pluginId: string, day: string): string => `observability:plugin-exec-tenant:${tenantId}:${pluginId}:${day}`;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface PluginDayStats {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  runs: number;
  errors: number;
  /** Wall-clock kills — the ANR / unresponsive signal, counted apart from plain errors. */
  timeouts: number;
  /** Mean duration of the day's runs, ms (0 when none). */
  avgMs: number;
}

export interface PluginExecutionStats {
  days: PluginDayStats[];
  totals: { runs: number; errors: number; timeouts: number; avgMs: number; errorRate: number; timeoutRate: number };
}

/** Count one execution into today's bucket. Fire-and-forget; never throws. */
export function rollUpPluginExecution(sample: PluginExecutionSample, now: number = Date.now()): void {
  const day = dayOf(now);
  void (async () => {
    try {
      const pipe = redis.multi();
      for (const k of [key(sample.pluginId, day), ...(sample.tenantId ? [tenantKey(sample.tenantId, sample.pluginId, day)] : [])]) {
        pipe.hincrby(k, 'runs', 1);
        pipe.hincrby(k, 'durationMs', Math.max(0, Math.round(sample.durationMs)));
        if (sample.outcome === 'error') pipe.hincrby(k, 'errors', 1);
        if (sample.outcome === 'timeout') pipe.hincrby(k, 'timeouts', 1);
        pipe.expire(k, PLUGIN_STATS_RETENTION_DAYS * 24 * 3600);
      }
      await pipe.exec();
    } catch (err) {
      Logger.warn(`[observability] plugin stats roll-up failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

/**
 * The last `days` UTC days (oldest first, including today and empty days so a
 * chart has a continuous axis) for one plugin, with window totals.
 */
export async function getPluginExecutionStats(
  pluginId: string,
  days = 14,
  now: number = Date.now(),
  /** Narrow to one workspace's own runs (the per-workspace counters); omitted → every workspace together. */
  tenantId?: string,
): Promise<PluginExecutionStats> {
  const span = Math.min(Math.max(1, Math.floor(days)), PLUGIN_STATS_RETENTION_DAYS);
  const dayList = Array.from({ length: span }, (_, i) => dayOf(now - (span - 1 - i) * DAY_MS));
  const pipe = redis.multi();
  for (const d of dayList) pipe.hgetall(tenantId ? tenantKey(tenantId, pluginId, d) : key(pluginId, d));
  const replies = (await pipe.exec()) ?? [];

  let runs = 0; let errors = 0; let timeouts = 0; let duration = 0;
  const out = dayList.map((day, i): PluginDayStats => {
    const h = (replies[i]?.[1] ?? {}) as Record<string, string>;
    const r = Number(h.runs) || 0;
    const e = Number(h.errors) || 0;
    const t = Number(h.timeouts) || 0;
    const d = Number(h.durationMs) || 0;
    runs += r; errors += e; timeouts += t; duration += d;
    return { day, runs: r, errors: e, timeouts: t, avgMs: r ? Math.round(d / r) : 0 };
  });
  return {
    days: out,
    totals: {
      runs, errors, timeouts,
      avgMs: runs ? Math.round(duration / runs) : 0,
      errorRate: runs ? errors / runs : 0,
      timeoutRate: runs ? timeouts / runs : 0,
    },
  };
}

// ── Recent plugin logs ───────────────────────────────────────────────────────
// What a plugin wrote through its `log` capability, kept short so its PUBLISHER can
// read it from the console (roadmap 6D, "isolate logs"). A capped list per plugin:
// level, a truncated message and a timestamp — deliberately NO structured meta and NO
// tenant id, because the reader is the publisher, across every workspace running the
// plugin. The message is whatever the plugin's own code chose to write; that is the
// publisher's code, and the console tells them not to log customer data.

export const PLUGIN_LOG_MAX_LINES = 200;
export const PLUGIN_LOG_RETENTION_DAYS = 7;
const MAX_MESSAGE_CHARS = 300;
const logKey = (pluginId: string): string => `observability:plugin-log:${pluginId}`;

export interface PluginLogLine {
  /** Epoch ms. */
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Append one line, newest first, trimmed to the cap. Fire-and-forget; never throws. */
export function recordPluginLog(
  pluginId: string,
  level: PluginLogLine['level'],
  message: string,
  now: number = Date.now(),
): void {
  const line: PluginLogLine = { at: now, level, message: String(message).slice(0, MAX_MESSAGE_CHARS) };
  const k = logKey(pluginId);
  void (async () => {
    try {
      const pipe = redis.multi();
      pipe.lpush(k, JSON.stringify(line));
      pipe.ltrim(k, 0, PLUGIN_LOG_MAX_LINES - 1);
      pipe.expire(k, PLUGIN_LOG_RETENTION_DAYS * 24 * 3600);
      await pipe.exec();
    } catch (err) {
      Logger.warn(`[observability] plugin log write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

/** The most recent lines for a plugin, newest first. */
export async function getPluginLogs(pluginId: string, limit = 100, level?: PluginLogLine['level']): Promise<PluginLogLine[]> {
  const raw = await redis.lrange(logKey(pluginId), 0, PLUGIN_LOG_MAX_LINES - 1);
  const out: PluginLogLine[] = [];
  for (const r of raw) {
    try {
      const l = JSON.parse(r) as PluginLogLine;
      if (!level || l.level === level) out.push(l);
    } catch { /* a corrupt line is skipped, not fatal */ }
    if (out.length >= limit) break;
  }
  return out;
}
