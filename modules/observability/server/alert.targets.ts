import Logger from '@kuraykaraaslan-labs/logger'
import { loadOnCallPeer } from './peers/peers'
import type { Alert } from './entities/alert.entity'
import { maxSeverity, type AlertSeverity } from './alert.enums'
import type { RouteTarget } from './alert.decision'

/**
 * Where an announced group of alerts goes (observability phase 11). Each target type is one small function; a route lists the ones it
 * wants. A target that cannot deliver says so (`ok: false` with a reason) and the dispatcher raises an alert about it, so a missing
 * on-call module or a failing channel never turns into a silent drop.
 */

export interface TargetContext {
  tenantId: string
  groupKey: string
  alerts: readonly Alert[]
  incidentId: string | null
  now: Date
}

export interface TargetResult { type: RouteTarget['type']; ok: boolean; reason?: string }

const MAX_PAYLOAD_ALERTS = 50

/** The group, as the outside world sees it. Annotations are already bounded at ingest; this only caps the list. */
export function buildGroupPayload(ctx: TargetContext): Record<string, unknown> {
  const severity: AlertSeverity = maxSeverity(ctx.alerts.map((a) => a.severity))
  return {
    groupKey: ctx.groupKey,
    severity,
    count: ctx.alerts.length,
    truncated: ctx.alerts.length > MAX_PAYLOAD_ALERTS,
    incidentId: ctx.incidentId,
    alerts: ctx.alerts.slice(0, MAX_PAYLOAD_ALERTS).map((a) => ({
      alertId: a.alertId, title: a.title, severity: a.severity, status: a.status, labels: a.labels, annotations: a.annotations,
      startsAt: a.startsAt, occurrences: a.count,
    })),
  }
}

/** One line for a notification subject: the first title, and how many more travel with it. */
export function summarize(alerts: readonly Pick<Alert, 'title'>[]): string {
  if (alerts.length === 0) return 'Alert'
  return alerts.length === 1 ? alerts[0].title : `${alerts[0].title} and ${alerts.length - 1} more`
}

function bodyOf(alerts: readonly Alert[]): string {
  const lines = alerts.slice(0, 10).map((a) => `[${a.severity}] ${a.title}${a.annotations?.summary && a.annotations.summary !== a.title ? ` — ${a.annotations.summary}` : ''}`)
  if (alerts.length > 10) lines.push(`… and ${alerts.length - 10} more`)
  return lines.join('\n')
}

async function notifyTarget(t: Extract<RouteTarget, { type: 'notify' }>, ctx: TargetContext): Promise<TargetResult> {
  try {
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service')
    const recipients = [
      ...(t.userIds ?? []).map((userId) => ({ userId })),
      ...(t.emails ?? []).map((email) => ({ email })),
    ]
    await NotificationService.notify(
      ctx.tenantId, recipients,
      { event: 'observability.alert', category: 'observability', title: summarize(ctx.alerts), body: bodyOf(ctx.alerts), data: buildGroupPayload(ctx) },
      {
        urgency: t.urgency ?? 'NORMAL',
        ...(t.channels?.length ? { channels: t.channels } : {}),
        // One announcement of a group is delivered once even if the dispatcher retries after a crash.
        idempotencyKey: `alert:${ctx.groupKey}:${ctx.alerts[0]?.alertId ?? 'none'}:${ctx.alerts.length}`,
      },
    )
    return { type: 'notify', ok: true }
  } catch (err) {
    return { type: 'notify', ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : 'notify failed' }
  }
}

async function webhookTarget(ctx: TargetContext, event: 'alert.firing' | 'alert.resolved' = 'alert.firing'): Promise<TargetResult> {
  try {
    const { default: WebhookService } = await import('@kuraykaraaslan-labs/webhook/server/webhook.service')
    await WebhookService.dispatchEvent(ctx.tenantId, event, buildGroupPayload(ctx))
    return { type: 'webhook', ok: true }
  } catch (err) {
    return { type: 'webhook', ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : 'webhook dispatch failed' }
  }
}

/**
 * The seam to the `on_call` module. `observability` never imports it statically (it must install without it): it is reached through
 * the `observability:on-call-peer` point, and a null answer (not installed, or switched off for this workspace) is a reported failure, never a silent drop.
 * The real contract is `OnCallService.page` / `resolveByDedupKey` (modules/on_call/README.md, "The contract for consumers").
 */
export interface OnCallPager {
  page(tenantId: string, input: {
    policyId: string; dedupKey: string; title: string; body: string; severity: AlertSeverity; payload: Record<string, unknown>
  }): Promise<unknown>
  /** The recovery half: resolve the open page that was triggered with this dedup key, if any. */
  resolve?(tenantId: string, dedupKey: string): Promise<unknown>
}

/** The pager has three levels. An incident-grade alert pages at the top one; WARNING and MINOR page as a warning; INFO is informational. */
export function pageSeverityOf(s: AlertSeverity): 'INFO' | 'WARNING' | 'CRITICAL' {
  return s === 'CRITICAL' || s === 'MAJOR' ? 'CRITICAL' : s === 'INFO' ? 'INFO' : 'WARNING'
}

function realOnCallLoader(tenantId: string): Promise<OnCallPager | null> {
  return loadOnCallPeer(tenantId).then((svc) => {
    if (!svc) return null
    return {
      page: (tid, i) => svc.page(tid, {
        policyId: i.policyId, title: i.title.slice(0, 200), body: i.body.slice(0, 2000), severity: pageSeverityOf(i.severity),
        source: 'observability:alert', sourceRef: i.dedupKey.slice(0, 200), dedupKey: i.dedupKey.slice(0, 200), metadata: i.payload,
      }),
      resolve: (tid, key) => svc.resolveByDedupKey(tid, key.slice(0, 200)),
    }
  })
}

let onCallLoader: (tenantId: string) => Promise<OnCallPager | null> = async (tenantId) => {
  try { return await realOnCallLoader(tenantId) } catch { return null }
}

const defaultOnCallLoader = onCallLoader

/** Test seam. */
export function setOnCallLoader(fn: typeof onCallLoader): void { onCallLoader = fn }
/** Test seam: back to the real loader. */
export function resetOnCallLoader(): void { onCallLoader = defaultOnCallLoader }

async function onCallTarget(t: Extract<RouteTarget, { type: 'on_call' }>, ctx: TargetContext): Promise<TargetResult> {
  const pager = await onCallLoader(ctx.tenantId)
  if (!pager) return { type: 'on_call', ok: false, reason: 'the on-call module is not installed or not active for this workspace' }
  try {
    await pager.page(ctx.tenantId, {
      policyId: t.policyId, dedupKey: ctx.groupKey, title: summarize(ctx.alerts), body: bodyOf(ctx.alerts),
      severity: maxSeverity(ctx.alerts.map((a) => a.severity)), payload: buildGroupPayload(ctx),
    })
    return { type: 'on_call', ok: true }
  } catch (err) {
    return { type: 'on_call', ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : 'paging failed' }
  }
}

/**
 * Recovery of a whole group: the page that was raised for it is resolved. Only when the group has no other open alert (the caller checks),
 * and only for a route that pages. A failure is logged: a page left open is visible in on-call and resolvable there.
 */
export async function resolveOnCallPages(targets: readonly RouteTarget[], tenantId: string, groupKey: string): Promise<void> {
  if (!targets.some((t) => t.type === 'on_call')) return
  try {
    const pager = await onCallLoader(tenantId)
    await pager?.resolve?.(tenantId, groupKey)
  } catch (err) {
    Logger.warn(`[alert.targets] could not resolve the on-call page for ${groupKey}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Run every target of a group's route(s). Never throws: a failing target is a result, not an exception. */
export async function runTargets(targets: readonly RouteTarget[], ctx: TargetContext): Promise<TargetResult[]> {
  const results: TargetResult[] = []
  const seen = new Set<string>()
  for (const t of targets) {
    // The same target listed by two matched routes is delivered once.
    const key = JSON.stringify(t)
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (t.type === 'notify') results.push(await notifyTarget(t, ctx))
      else if (t.type === 'webhook') results.push(await webhookTarget(ctx))
      else if (t.type === 'on_call') results.push(await onCallTarget(t, ctx))
    } catch (err) {
      Logger.error(`[alert.targets] ${t.type} threw: ${err instanceof Error ? err.message : String(err)}`)
      results.push({ type: t.type, ok: false, reason: 'unexpected error' })
    }
  }
  return results
}

/** Resolve notices go to webhook targets only: a person already knows, and a recovery is not worth a page. */
export async function runResolvedTargets(targets: readonly RouteTarget[], ctx: TargetContext): Promise<void> {
  if (targets.some((t) => t.type === 'webhook')) await webhookTarget(ctx, 'alert.resolved')
}
