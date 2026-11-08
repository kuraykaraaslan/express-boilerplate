/**
 * Control-plane caps on the leases a probe runner may hold at once, and what to shed when a cap is hit (observability phase 10, respond track).
 * Pure: no database, no clock, no environment, so the rules are one table of tests.
 *
 * A lease is OUTSTANDING from the moment it is handed out until it is resulted or expires (`completedAt` null and `expiresAt` in the future).
 * Two caps bound how many a tenant and the whole platform may have outstanding:
 *   - per tenant: the plan limit `observability.limit.runner_leases`, else the deployment default `OBSERVABILITY_PROBE_TENANT_LEASE_CAP`;
 *   - global:     the deployment value `OBSERVABILITY_PROBE_GLOBAL_LEASE_CAP`.
 * For both, `0` or unset means NO CAP (today's behaviour): a cap of zero would stop all probing, which is never what an operator means.
 *
 * Shedding. A due check that would exceed a cap is not leased on this poll. It is not lost and nothing is fabricated: it stays due and is leased on a
 * later poll once capacity frees up (its last sample did not move, so it is still overdue). What is shed first:
 *   1. Priority CLASS, lowest first: class 0 liveness (heartbeat-adjacent: PING, DNS; a HEARTBEAT monitor is pushed to and never leased) >
 *      class 1 network checks (HTTP, TCP) > class 2 heavy checks (STEPS, TLS, DOMAIN, BROWSER).
 *   2. Within a class the SHORTER interval wins: a monitor checked more often is the one whose silence is noticed first.
 *   3. Then the one that has waited longest, then the monitor id (so the order is deterministic).
 * Fairness. Priority orders ONE tenant's checks. Between tenants the GLOBAL room is shared max-min fairly (`fairShare`): no tenant is held below an equal
 * share by another tenant's backlog, and a tenant that wants less than its share leaves the rest to the others. A tenant at its own cap simply wants
 * nothing more, so it can never starve the others.
 */

/** 0 = liveness (highest), 1 = network, 2 = heavy (shed first). */
export type LeaseClass = 0 | 1 | 2

export function leaseClass(type: string): LeaseClass {
  switch (type) {
    case 'HEARTBEAT': case 'PING': case 'DNS': return 0
    case 'STEPS': case 'TLS': case 'DOMAIN': case 'BROWSER': return 2
    default: return 1 // HTTP, TCP and any type this build does not know
  }
}

export interface Prioritised { monitorId: string; type: string; intervalSeconds: number; /** ms since epoch of this location's last sample, or null when it never ran here. */ lastRunAt?: number | null }

/** Negative when `a` is MORE important than `b` (Array.prototype.sort order: most important first). */
export function comparePriority(a: Prioritised, b: Prioritised): number {
  return leaseClass(a.type) - leaseClass(b.type)
    || a.intervalSeconds - b.intervalSeconds
    || (a.lastRunAt ?? -Infinity) - (b.lastRunAt ?? -Infinity)
    || (a.monitorId < b.monitorId ? -1 : a.monitorId > b.monitorId ? 1 : 0)
}

/** One number that sorts like `comparePriority` on its first two keys (class, then interval): lower is more important. */
export function rankOf(p: Pick<Prioritised, 'type' | 'intervalSeconds'>): number { return leaseClass(p.type) * 1_000_000 + Math.min(Math.max(0, p.intervalSeconds), 999_999) }

export function byPriority<T extends Prioritised>(items: readonly T[]): T[] { return [...items].sort(comparePriority) }

/** A cap value as configured: only a finite number above zero is a cap. */
export function effectiveCap(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null
}

/** How many more leases a tenant may take: its cap minus what it has outstanding (never negative), or Infinity without a cap. */
export function roomUnder(cap: number | null, outstanding: number): number {
  return cap === null ? Number.POSITIVE_INFINITY : Math.max(0, cap - Math.max(0, outstanding))
}

/**
 * Share `room` between claimants who want `wants[k]` each, max-min fairly (water filling): the smallest wants are served in full, the rest split what remains
 * equally, and a remainder that does not divide goes one each to the claimants whose NEXT check ranks highest (`rank`: lower is better). Deterministic.
 */
export function fairShare<K>(wants: ReadonlyMap<K, number>, room: number, rank: (k: K) => number = () => 0): Map<K, number> {
  const out = new Map<K, number>()
  const keys = [...wants.keys()].filter((k) => (wants.get(k) ?? 0) > 0)
  for (const k of wants.keys()) out.set(k, 0)
  if (keys.length === 0 || room <= 0) return out
  const total = keys.reduce((s, k) => s + (wants.get(k) as number), 0)
  if (!Number.isFinite(room) || total <= room) { for (const k of keys) out.set(k, wants.get(k) as number); return out }

  let remaining = Math.floor(room)
  const pending = [...keys].sort((a, b) => (wants.get(a) as number) - (wants.get(b) as number))
  const open: K[] = []
  for (let i = 0; i < pending.length; i += 1) {
    const k = pending[i]
    const equal = Math.floor(remaining / (pending.length - i))
    const want = wants.get(k) as number
    // sorted ascending: the first want that does not fit an equal share means none of the larger ones fit either
    if (want <= equal) { out.set(k, want); remaining -= want } else { open.push(...pending.slice(i)); break }
  }
  if (open.length === 0) return out
  const base = Math.floor(remaining / open.length)
  for (const k of open) out.set(k, base)
  let extra = remaining - base * open.length
  for (const k of [...open].sort((a, b) => rank(a) - rank(b))) {
    if (extra <= 0) break
    if ((out.get(k) as number) < (wants.get(k) as number)) { out.set(k, (out.get(k) as number) + 1); extra -= 1 }
  }
  return out
}
