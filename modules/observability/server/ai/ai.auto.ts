/**
 * The automatic runs of the investigator (phase 20.2, work order 2 item 3), for tenants that switched them on.
 *
 * WHEN. An incident that has just opened has the thinnest evidence it will ever have: the alert group is still filling, the first deploys and
 * telemetry have not landed. So the run on open is a DELAYED job (`autoRunDelayMinutes`, tenant setting, default 2; 0 runs at once), and a
 * second, optional run happens once when the incident resolves (`onIncidentResolve`, with the whole picture).
 *
 * HOW. A BullMQ delayed job (`ai.auto.job.ts`) with a deterministic job id (`tenant, incident, phase`), so scheduling twice schedules once. The
 * job body is `runAutoInvestigation`, which re-reads everything at run time (a tenant that switched AI off in the meantime costs nothing) and
 * is also what the sweep (`sweepAutoInvestigations`, a cron twin for serverless and a safety net for a lost job) calls. The DATABASE is the
 * state: the run's row decides whether it already happened.
 *
 * CAPS. At most ONE automatic run per incident per phase (`AUTO` for the open run, `RESOLVE` for the resolve run; a failed or empty run counts,
 * because it is also what the daily cap counts), a Redis claim so two nodes cannot both start the same run, the tenant's daily cap inside
 * `investigate` (the gate), and at most `MAX_RUNS_PER_SWEEP` runs per tenant per sweep. Best effort and silent: nothing here ever throws into the
 * code that opened or resolved an incident.
 */
import Logger from '@kuraykaraaslan-labs/logger';
import { realInvestigatorDeps } from './ai.deps';
import { investigate } from './ai.investigator';
import { getAiSettings } from './ai.settings';
import type { AiSettings } from './ai.settings.schema';
import { listRuns } from './ai.store';

export type AutoPhase = 'open' | 'resolve';
export interface AutoJob { tenantId: string; incidentId: string; phase: AutoPhase }
export type AutoOutcome = 'ran' | 'off' | 'not_found' | 'already_ran' | 'superseded' | 'not_ready' | 'claimed' | 'failed';

export const TRIGGER_OF = { open: 'AUTO', resolve: 'RESOLVE' } as const satisfies Record<AutoPhase, string>;
export const MAX_RUNS_PER_SWEEP = 5;
/** The sweep only looks at incidents this young: an older one is history, not something to analyse now. */
export const SWEEP_WINDOW_MS = 24 * 60 * 60_000;
const CLAIM_TTL_SECONDS = 15 * 60;

/** BullMQ forbids ':' in a custom job id. */
export const autoJobId = (j: AutoJob): string => `ai-auto__${j.tenantId}__${j.incidentId}__${j.phase}`;

export interface AutoIncident { incidentId: string; status: string; startedAt: Date | string; resolvedAt?: Date | string | null }

export interface AutoDeps {
  settings(tenantId: string): Promise<AiSettings>;
  incident(tenantId: string, incidentId: string): Promise<AutoIncident | null>;
  /** Recent incidents of the tenant (the sweep's candidates). */
  recent(tenantId: string, since: Date): Promise<AutoIncident[]>;
  hasRun(tenantId: string, incidentId: string, trigger: 'AUTO' | 'RESOLVE'): Promise<boolean>;
  /** Claim the right to run; false when somebody else holds it. A store that cannot answer says true (the database check is the main guard). */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  investigate(tenantId: string, incidentId: string, trigger: 'AUTO' | 'RESOLVE'): Promise<void>;
  /** Put a delayed job in the queue. False when there is no queue (no Redis, no worker): the sweep is then the way it runs. */
  schedule(job: AutoJob, delayMs: number): Promise<boolean>;
  now(): Date;
}

export const realAutoDeps: AutoDeps = {
  settings: getAiSettings,
  async incident(tenantId, incidentId) {
    const [{ withTenantRepositoryFor }, { Incident }] = await Promise.all([import('@kuraykaraaslan-labs/db'), import('../entities/incident.entity')]);
    return withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }));
  },
  async recent(tenantId, since) {
    const [{ withTenantRepositoryFor }, { Incident }, { MoreThanOrEqual }] = await Promise.all([import('@kuraykaraaslan-labs/db'), import('../entities/incident.entity'), import('typeorm')]);
    return withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({ where: { tenantId, startedAt: MoreThanOrEqual(since) }, order: { startedAt: 'ASC' }, take: 200 }));
  },
  async hasRun(tenantId, incidentId, trigger) {
    return (await listRuns(tenantId, incidentId, ['INVESTIGATION'])).some((r) => r.trigger === trigger);
  },
  async claim(key, ttlSeconds) {
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis');
      return (await redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    } catch { return true; }
  },
  async investigate(tenantId, incidentId, trigger) {
    await investigate(realInvestigatorDeps(), tenantId, incidentId, { trigger });
  },
  async schedule(job, delayMs) {
    try {
      const m = await import('./ai.auto.job');
      return await m.enqueueAutoInvestigation(job, delayMs);
    } catch (e) {
      Logger.warn(`[ai.auto] no queue to schedule on (${e instanceof Error ? e.message : String(e)}); the sweep will run it`);
      return false;
    }
  },
  now: () => new Date(),
};

const asDate = (d: Date | string) => new Date(d).getTime();

export function phaseEnabled(s: AiSettings, phase: AutoPhase): boolean {
  return s.enabled && (phase === 'open' ? s.onIncidentOpen : s.onIncidentResolve);
}

/**
 * Run one automatic investigation if, right now, it should happen. Pure decisions first, then the claim, then the run. Never throws.
 * `not_ready`: the delay has not elapsed (the setting was raised after scheduling) or a resolve run for an incident that is not resolved.
 */
export async function runAutoInvestigation(job: AutoJob, deps: AutoDeps = realAutoDeps): Promise<AutoOutcome> {
  try {
    const settings = await deps.settings(job.tenantId);
    if (!phaseEnabled(settings, job.phase)) return 'off';
    const incident = await deps.incident(job.tenantId, job.incidentId);
    if (!incident) return 'not_found';
    const now = deps.now().getTime();
    if (job.phase === 'open') {
      // Resolved while it waited, and the resolve run is on: that run sees the whole picture, this one would only spend the cap on half of it.
      if (incident.status === 'RESOLVED' && settings.onIncidentResolve) return 'superseded';
      if (now < asDate(incident.startedAt) + settings.autoRunDelayMinutes * 60_000) return 'not_ready';
    } else if (incident.status !== 'RESOLVED') {
      return 'not_ready';
    }
    const trigger = TRIGGER_OF[job.phase];
    if (await deps.hasRun(job.tenantId, job.incidentId, trigger)) return 'already_ran';
    if (!(await deps.claim(autoJobId(job), CLAIM_TTL_SECONDS))) return 'claimed';
    await deps.investigate(job.tenantId, job.incidentId, trigger);
    return 'ran';
  } catch (e) {
    Logger.warn(`[ai.auto] ${job.phase} investigation skipped for ${job.incidentId}: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
}

/** An incident has opened. True when a run happened (no delay) or was scheduled (a delay). */
export async function maybeInvestigateOnOpen(tenantId: string, incidentId: string, deps: AutoDeps = realAutoDeps): Promise<boolean> {
  try {
    const settings = await deps.settings(tenantId);
    if (!phaseEnabled(settings, 'open')) return false;
    const job: AutoJob = { tenantId, incidentId, phase: 'open' };
    if (settings.autoRunDelayMinutes === 0) return (await runAutoInvestigation(job, deps)) === 'ran';
    return await deps.schedule(job, settings.autoRunDelayMinutes * 60_000);
  } catch (e) {
    Logger.warn(`[ai.auto] scheduling on open skipped for ${incidentId}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** An incident has resolved. True when the run happened or was scheduled. Without a queue it runs here (this is already off the request path). */
export async function maybeInvestigateOnResolve(tenantId: string, incidentId: string, deps: AutoDeps = realAutoDeps): Promise<boolean> {
  try {
    const settings = await deps.settings(tenantId);
    if (!phaseEnabled(settings, 'resolve')) return false;
    const job: AutoJob = { tenantId, incidentId, phase: 'resolve' };
    if (await deps.schedule(job, 0)) return true;
    return (await runAutoInvestigation(job, deps)) === 'ran';
  } catch (e) {
    Logger.warn(`[ai.auto] scheduling on resolve skipped for ${incidentId}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export interface AutoSweepSummary { examined: number; ran: number; skipped: number }

/**
 * One tenant's pass over its recent incidents: whatever is due and has not run yet runs now (at most `MAX_RUNS_PER_SWEEP`). This is what makes
 * the delay real where no worker holds a delayed job (serverless cron), and what picks up a job the queue lost.
 */
export async function sweepAutoInvestigations(tenantId: string, deps: AutoDeps = realAutoDeps): Promise<AutoSweepSummary> {
  const summary: AutoSweepSummary = { examined: 0, ran: 0, skipped: 0 };
  const settings = await deps.settings(tenantId);
  if (!settings.enabled || (!settings.onIncidentOpen && !settings.onIncidentResolve)) return summary;
  const now = deps.now();
  for (const i of await deps.recent(tenantId, new Date(now.getTime() - SWEEP_WINDOW_MS))) {
    if (summary.ran >= MAX_RUNS_PER_SWEEP) break;
    const phases: AutoPhase[] = i.status === 'RESOLVED' ? ['open', 'resolve'] : ['open'];
    for (const phase of phases) {
      if (summary.ran >= MAX_RUNS_PER_SWEEP) break;
      if (!phaseEnabled(settings, phase)) continue;
      summary.examined += 1;
      const outcome = await runAutoInvestigation({ tenantId, incidentId: i.incidentId, phase }, deps);
      if (outcome === 'ran') summary.ran += 1; else summary.skipped += 1;
    }
  }
  return summary;
}
