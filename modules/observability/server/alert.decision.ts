import { z } from 'zod'
import { IncidentActionEnum, RouteTargetTypeEnum, type AlertSource, type IncidentAction } from './alert.enums'
import { matchesAll, readStoredMatchers, type Labels, type Matcher } from './alert.matchers'
import { inhibitingEntity, entitiesOf, type DependencyEdge } from './alert.inhibit'
import { DEFAULT_GROUP_INTERVAL_SECONDS, DEFAULT_GROUP_WAIT_SECONDS } from './alert.grouping'

/**
 * The whole decision about one alert, as ONE pure function (observability phase 11): is it muted, which route claims it, how is it
 * grouped, where does it go. Ingest and the routing simulator both call it, so "where would this alert go?" and "where did it go?"
 * cannot disagree. No I/O: the service hands it the routes, silences, dependency edges and the entities that are firing right now.
 */

const Uuid = z.string().uuid()

export const NotifyTargetSchema = z.object({
  type: z.literal('notify'),
  userIds: z.array(Uuid).max(20).optional(),
  emails: z.array(z.string().email()).max(20).optional(),
  channels: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,31}$/)).max(8).optional(),
  urgency: z.enum(['NORMAL', 'CRITICAL']).optional(),
}).refine((t) => (t.userIds?.length ?? 0) + (t.emails?.length ?? 0) > 0, { message: 'a notify target needs at least one user or email' })

export const RouteTargetSchema = z.union([
  NotifyTargetSchema,
  z.object({ type: z.literal('webhook') }),
  z.object({ type: z.literal('on_call'), policyId: Uuid }),
  z.object({ type: z.literal('drop') }),
])
export type RouteTarget = z.infer<typeof RouteTargetSchema>
export const RouteTargetListSchema = z.array(RouteTargetSchema).max(10)

export interface RouteLike {
  routeId: string
  name: string
  position: number
  matchers: unknown
  groupBy: unknown
  groupWaitSeconds: number
  groupIntervalSeconds: number
  targets: unknown
  incident?: string | null
  continueMatching: boolean
  enabled: boolean
}

export interface SilenceLike { silenceId: string; matchers: unknown; startsAt: Date; endsAt: Date }

export interface DecisionInput {
  source: AlertSource
  labels: Labels
  duringMaintenance?: boolean
  routes: readonly RouteLike[]
  silences: readonly SilenceLike[]
  edges: readonly DependencyEdge[]
  /** Entities with a FIRING alert right now (never including the alert being decided). */
  firingEntities: ReadonlySet<string>
  now: Date
}

export interface Decision {
  /** `maintenance`, `silence:<id>`, `inhibited:<entity>`, `dropped`, or null when the alert may be announced. */
  suppressedBy: string | null
  /** The first route that claimed it, or null when the built-in default applies. */
  routeId: string | null
  matchedRouteIds: string[]
  groupBy: string[]
  groupWaitSeconds: number
  groupIntervalSeconds: number
  targets: RouteTarget[]
  incident: IncidentAction | null
}

/** Used when no route claims an alert: one group per monitored thing for monitors, per alert name for everything else. */
export function defaultGrouping(source: AlertSource): string[] {
  return source === 'monitor' || source === 'process' ? ['entity'] : ['alertname']
}

function readGroupBy(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(x)).slice(0, 10) : []
}

/** The targets stored on a route, defensively: an entry that does not parse is dropped, never thrown on. */
export function readRouteTargets(raw: unknown): RouteTarget[] {
  const r = RouteTargetListSchema.safeParse(raw ?? [])
  return r.success ? r.data : []
}

export function decide(input: DecisionInput): Decision {
  const { labels, now } = input

  // Routing: ordered, first match wins unless a route says continue; the targets of every matched route are used.
  const matched: RouteLike[] = []
  for (const route of [...input.routes].filter((r) => r.enabled).sort((a, b) => a.position - b.position)) {
    const matchers = readStoredMatchers(route.matchers)
    if (matchers === null) continue // a stored matcher list that does not parse never claims an alert
    if (!matchesAll(matchers as Matcher[], labels)) continue
    matched.push(route)
    if (!route.continueMatching) break
  }
  const first = matched[0] ?? null
  const targets = matched.flatMap((r) => readRouteTargets(r.targets))

  // Suppression, strongest reason first. A planned window outranks a person's mute, which outranks the dependency graph.
  let suppressedBy: string | null = null
  if (input.duringMaintenance) suppressedBy = 'maintenance'
  if (!suppressedBy) {
    for (const s of input.silences) {
      if (s.startsAt.getTime() > now.getTime() || s.endsAt.getTime() <= now.getTime()) continue
      const matchers = readStoredMatchers(s.matchers)
      if (matchers !== null && matchesAll(matchers as Matcher[], labels)) { suppressedBy = `silence:${s.silenceId}`; break }
    }
  }
  if (!suppressedBy) {
    const by = inhibitingEntity(input.edges, entitiesOf(labels), input.firingEntities)
    if (by) suppressedBy = `inhibited:${by}`
  }
  if (!suppressedBy && targets.some((t) => t.type === 'drop')) suppressedBy = 'dropped'

  const incident = first?.incident ? (IncidentActionEnum.safeParse(first.incident).data ?? null) : null
  return {
    suppressedBy,
    routeId: first?.routeId ?? null,
    matchedRouteIds: matched.map((r) => r.routeId),
    groupBy: first ? readGroupBy(first.groupBy) : defaultGrouping(input.source),
    groupWaitSeconds: first ? first.groupWaitSeconds : DEFAULT_GROUP_WAIT_SECONDS,
    groupIntervalSeconds: first ? first.groupIntervalSeconds : DEFAULT_GROUP_INTERVAL_SECONDS,
    targets: targets.filter((t) => t.type !== 'drop'),
    incident,
  }
}

export { RouteTargetTypeEnum }
