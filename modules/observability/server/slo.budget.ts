/**
 * SLO arithmetic (observability phase 13). Pure: no I/O, no clock, so every edge case is a unit test.
 *
 * Vocabulary: an SLI is good events over total events; the objective is the share that must be good (99.9 means 99.9 %); the error
 * budget is what may go wrong (0.1 %); the burn rate is how many times faster than "exactly on budget" the budget is being spent.
 *
 * The alerting method is the multiwindow, multi-burn-rate one from the Google SRE Workbook, chapter 5 ("Alerting on SLOs", table 5-8,
 * read on 2026-10-18 before it was encoded): for a 30-day window, page at 14.4x over 1 hour (2 % of the budget), page at 6x over 6 hours
 * (5 %), open a ticket at 1x over 3 days (10 %); each tier also needs a SHORT window (1/12 of the long one) to be burning too, so an
 * alert stops about five minutes after the errors stop instead of staying red for an hour.
 */

export interface Counts { good: number; total: number }

/** Good over total, or null when nothing was measured (an unmeasured window is "no data", never "100 %"). */
export function sli(c: Counts): number | null {
  return c.total > 0 ? c.good / c.total : null
}

/** The share of events that may be bad: 99.9 → 0.001. */
export function allowedErrorRate(objectivePercent: number): number {
  return Math.max(0, 1 - objectivePercent / 100)
}

/** Errors per event in this window, or null with no events. */
export function errorRate(c: Counts): number | null {
  const s = sli(c)
  return s === null ? null : Math.max(0, 1 - s)
}

/**
 * How fast the budget is being spent: 1 is exactly on budget, 14.4 is the whole 30-day budget in two days. Null with no data. A 100 %
 * objective has no budget at all: any error is an infinite burn, and no error is none.
 */
export function burnRate(c: Counts, objectivePercent: number): number | null {
  const e = errorRate(c)
  if (e === null) return null
  const allowed = allowedErrorRate(objectivePercent)
  if (allowed === 0) return e === 0 ? 0 : Number.POSITIVE_INFINITY
  return e / allowed
}

export type BudgetState = 'NO_DATA' | 'OK' | 'LOW' | 'EXHAUSTED'

export interface BudgetStatus {
  sli: number | null
  /** Share of the window's budget already spent: 0.4 is 40 %. Can exceed 1. Null without data. */
  consumedFraction: number | null
  /** What is left, 1 - consumed. Negative once the budget is overspent. */
  remainingFraction: number | null
  state: BudgetState
}

/** Where the budget stands over a whole SLO window. `lowBelowPercent` is the remaining share under which the state reads LOW. */
export function budgetStatus(c: Counts, objectivePercent: number, lowBelowPercent = 25): BudgetStatus {
  const s = sli(c)
  if (s === null) return { sli: null, consumedFraction: null, remainingFraction: null, state: 'NO_DATA' }
  const allowed = allowedErrorRate(objectivePercent)
  // Rounded to 9 places: 0.75 of a budget must read as exactly 0.75, not 0.7499999999999993, or "exactly 25 % left" flips state on float noise.
  const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x)
  const consumed = allowed === 0 ? (s < 1 ? Number.POSITIVE_INFINITY : 0) : round(Math.max(0, 1 - s) / round(allowed))
  const remaining = round(1 - consumed)
  const state: BudgetState = remaining <= 0 ? 'EXHAUSTED' : remaining * 100 < lowBelowPercent ? 'LOW' : 'OK'
  return { sli: s, consumedFraction: consumed, remainingFraction: remaining, state }
}

/**
 * Days until the budget runs out if the window keeps burning at `burn`: remaining budget divided by the daily spend (burn / windowDays).
 * Null when it is not burning faster than it refills or there is nothing to project; 0 once exhausted.
 */
export function projectedExhaustionDays(burn: number | null, remainingFraction: number | null, windowDays: number): number | null {
  if (burn === null || remainingFraction === null || !Number.isFinite(burn) || burn <= 0) return null
  if (remainingFraction <= 0) return 0
  return (remainingFraction * windowDays) / burn
}

// ---- burn-rate tiers ---------------------------------------------------------------------------------------------------------

export interface BurnTier {
  id: 'fast' | 'medium' | 'slow'
  /** Page, or ticket (the workbook's two actions). Mapped to alert severities below. */
  action: 'page' | 'ticket'
  longHours: number
  shortHours: number
  /** The share of the whole window's budget that spending at the tier's rate for the long window consumes. */
  budgetConsumed: number
}

/** The workbook's table 5-8. The short window is 1/12 of the long one in every row. */
export const BURN_TIERS: readonly BurnTier[] = [
  { id: 'fast', action: 'page', longHours: 1, shortHours: 5 / 60, budgetConsumed: 0.02 },
  { id: 'medium', action: 'page', longHours: 6, shortHours: 0.5, budgetConsumed: 0.05 },
  { id: 'slow', action: 'ticket', longHours: 72, shortHours: 6, budgetConsumed: 0.10 },
]

/**
 * The burn rate that makes a tier fire for an SLO window of `windowDays`. The workbook's numbers are for 30 days; deriving them from
 * "share of the budget consumed over the long window" reproduces 14.4 / 6 / 1 at 30 days exactly, and scales correctly for 7, 28 or 90.
 */
export function tierBurnRate(tier: BurnTier, windowDays: number): number {
  return (tier.budgetConsumed * windowDays * 24) / tier.longHours
}

/** The alert severity of a tier: a page is CRITICAL (fast) or MAJOR (medium); a ticket is WARNING. */
export function tierSeverity(tier: BurnTier): 'CRITICAL' | 'MAJOR' | 'WARNING' {
  return tier.id === 'fast' ? 'CRITICAL' : tier.id === 'medium' ? 'MAJOR' : 'WARNING'
}

/**
 * A single failed probe among a handful must not page: with probes a minute apart a 5-minute window holds five samples, and one failure
 * among them is a 20 % error rate, over any burn threshold. The short window has to contain at least this many BAD events. (A deviation
 * for sparse synthetic data, recorded in the phase file; request-rate SLIs have thousands of events and never notice it.)
 */
export const MIN_BAD_EVENTS_IN_SHORT_WINDOW = 2

export interface TierEvaluation {
  tier: BurnTier
  thresholdBurnRate: number
  longBurn: number | null
  shortBurn: number | null
  firing: boolean
}

/** Both windows must burn at or above the tier's rate (and the short window must hold enough bad events). */
export function evaluateTier(tier: BurnTier, longCounts: Counts, shortCounts: Counts, objectivePercent: number, windowDays: number): TierEvaluation {
  const thresholdBurnRate = tierBurnRate(tier, windowDays)
  const longBurn = burnRate(longCounts, objectivePercent)
  const shortBurn = burnRate(shortCounts, objectivePercent)
  const shortBad = shortCounts.total - shortCounts.good
  const firing = longBurn !== null && shortBurn !== null
    && longBurn >= thresholdBurnRate && shortBurn >= thresholdBurnRate && shortBad >= MIN_BAD_EVENTS_IN_SHORT_WINDOW
  return { tier, thresholdBurnRate, longBurn, shortBurn, firing }
}
