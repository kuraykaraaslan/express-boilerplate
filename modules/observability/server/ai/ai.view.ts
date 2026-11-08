/** The shape of an AI run the routes and screens see (phase 20): the stored row without internals. Pure, no I/O. */
import type { IncidentAiNote } from '../entities/incident_ai_note.entity';

/** What the screens and the API return: the run without internals. */
export function runView(n: IncidentAiNote) {
  return {
    noteId: n.noteId, incidentId: n.incidentId ?? null, kind: n.kind, status: n.status, trigger: n.trigger, provider: n.provider ?? null, model: n.model ?? null, promptVersion: n.promptVersion ?? null,
    inputTokens: n.inputTokens, outputTokens: n.outputTokens, result: n.result ?? null, evidence: n.evidence ?? [], failure: n.failure ?? null, feedback: n.feedback ?? null, createdAt: new Date(n.createdAt).toISOString(),
    aiGenerated: true as const,
  };
}
export type AiRunView = ReturnType<typeof runView>;
