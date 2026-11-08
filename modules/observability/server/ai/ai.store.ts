/**
 * Persistence of AI runs (phase 20): the row, the timeline pointer, thumbs feedback and the daily count the cap reads.
 */
import { MoreThanOrEqual } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { IncidentAiNote } from '../entities/incident_ai_note.entity';
import { recordIncidentEvent } from '../incident.timeline.service';
import { runView } from './ai.view';

export { runView };
export type { AiRunView } from './ai.view';

export type AiRunKind = 'INVESTIGATION' | 'STATUS_DRAFT' | 'POSTMORTEM_DRAFT' | 'NL_QUERY';

export interface NewRun {
  incidentId?: string | null;
  kind: AiRunKind;
  status: 'OK' | 'EMPTY' | 'FAILED';
  trigger: 'MANUAL' | 'AUTO' | 'RESOLVE';
  requestedBy?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  result?: Record<string, unknown> | null;
  evidence?: unknown[] | null;
  failure?: string | null;
}

export const utcDayStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Runs recorded today (UTC), every kind and outcome. `EMPTY` runs made no model call and are not counted. */
export async function countRunsToday(tenantId: string, now: Date = new Date()): Promise<number> {
  const rows = await withTenantRepositoryFor(tenantId, IncidentAiNote, (repo) => repo.find({ where: { tenantId, createdAt: MoreThanOrEqual(utcDayStart(now)) }, take: 5000 }));
  return rows.filter((r) => r.status !== 'EMPTY').length;
}

export async function saveRun(tenantId: string, run: NewRun): Promise<IncidentAiNote> {
  return withTenantRepositoryFor(tenantId, IncidentAiNote, async (repo) => {
    const row = repo.create({
      tenantId, incidentId: run.incidentId ?? null, kind: run.kind, status: run.status, trigger: run.trigger, requestedBy: run.requestedBy ?? null,
      provider: run.provider ?? null, model: run.model ?? null, promptVersion: run.promptVersion ?? null, inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0,
      result: run.result ?? null, evidence: run.evidence ?? null, failure: run.failure ?? null,
    } as never);
    return repo.save(row as never) as unknown as IncidentAiNote;
  });
}

/** The timeline entry: type AI_NOTE, flagged AI-generated, pointing at the stored run. Short, scalar, bounded by the timeline service itself. */
export async function recordAiTimelineNote(tenantId: string, incidentId: string, note: IncidentAiNote, summary: string, actorId?: string | null): Promise<void> {
  await recordIncidentEvent(tenantId, incidentId, 'AI_NOTE', { actorId: actorId ?? null, data: { aiGenerated: true, noteId: note.noteId, kind: note.kind, status: note.status, trigger: note.trigger, summary: summary.slice(0, 280) } });
}

export async function listRuns(tenantId: string, incidentId: string, kinds?: readonly AiRunKind[]): Promise<IncidentAiNote[]> {
  const rows = await withTenantRepositoryFor(tenantId, IncidentAiNote, (repo) => repo.find({ where: { tenantId, incidentId }, order: { createdAt: 'DESC' }, take: 50 }));
  return kinds ? rows.filter((r) => kinds.includes(r.kind as AiRunKind)) : rows;
}

export async function getRun(tenantId: string, noteId: string): Promise<IncidentAiNote | null> {
  return withTenantRepositoryFor(tenantId, IncidentAiNote, (repo) => repo.findOne({ where: { tenantId, noteId } }));
}

/** Thumbs up (1) or down (-1) on a run. The same person may change their mind; another tenant's note is a 404, like a missing one. */
export async function setFeedback(tenantId: string, incidentId: string, noteId: string, value: 1 | -1 | null, userId: string | null): Promise<IncidentAiNote> {
  const row = await getRun(tenantId, noteId);
  if (!row || row.incidentId !== incidentId) throw new AppError('Note not found', 404, ErrorCode.NOT_FOUND);
  if (row.status === 'FAILED') throw new AppError('A failed run cannot be rated', 409, ErrorCode.CONFLICT);
  row.feedback = value; row.feedbackBy = value === null ? null : userId; row.feedbackAt = value === null ? null : new Date();
  return withTenantRepositoryFor(tenantId, IncidentAiNote, (repo) => repo.save(row));
}

