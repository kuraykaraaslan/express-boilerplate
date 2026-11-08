/**
 * What the model may answer, and the CITATION RULE (phase 20.2). The model's text is parsed through a strict schema (unknown keys, wrong types,
 * oversize lists are all a parse failure, never "best effort"), and then every claim is checked against the evidence bundle: a claim that
 * cites nothing, or cites an id that is not in the bundle, is dropped before anything is stored or shown. A hypothesis none of whose claims
 * survive is dropped with them. The citation rule is the product: a hallucinated root cause that reaches the screen costs more trust than no
 * AI at all.
 *
 * Claim text is also cleaned (`hygiene.ts`): the model may repeat a secret it saw, or emit control characters.
 */
import { z } from 'zod';
import { cleanText } from '../hygiene';
import type { EvidenceBundle } from './ai.evidence';

export const EVIDENCE_ID = /^E[1-9][0-9]{0,2}$/;

export const ClaimSchema = z.object({
  text: z.string().trim().min(3).max(500),
  // An empty list parses on purpose: the claim is then DROPPED by `enforceCitations` (one bad claim must not cost the whole answer).
  evidence: z.array(z.string().regex(EVIDENCE_ID)).max(6),
}).strict();

export const HypothesisSchema = z.object({
  title: z.string().trim().min(3).max(160),
  confidence: z.enum(['low', 'medium', 'high']),
  claims: z.array(ClaimSchema).min(1).max(5),
}).strict();

export const InvestigationOutputSchema = z.object({
  summary: z.array(ClaimSchema).min(1).max(5),
  hypotheses: z.array(HypothesisSchema).max(5),
}).strict();
export type InvestigationOutput = z.infer<typeof InvestigationOutputSchema>;

export interface CitedClaim { text: string; evidence: string[] }
export interface CitedHypothesis { rank: number; title: string; confidence: 'low' | 'medium' | 'high'; claims: CitedClaim[] }

export interface CitedResult {
  summary: CitedClaim[];
  hypotheses: CitedHypothesis[];
  dropped: { claims: number; hypotheses: number };
}

export class AiOutputError extends Error {
  constructor(message: string, readonly kind: 'unparseable' | 'schema') { super(message); this.name = 'AiOutputError'; }
}

const MAX_OUTPUT_CHARS = 20_000;

/** The model's reply as a JSON value. One surrounding code fence is tolerated (models add them); nothing else is repaired. */
export function extractJson(text: string): unknown {
  if (typeof text !== 'string' || text.length > MAX_OUTPUT_CHARS) throw new AiOutputError('The model reply is missing or too long', 'unparseable');
  let body = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(body);
  if (fence) body = fence[1]!.trim();
  try { return JSON.parse(body); } catch { throw new AiOutputError('The model reply is not JSON', 'unparseable'); }
}

/** The investigator's reply, strictly. */
export function parseModelOutput(text: string): InvestigationOutput {
  const json = extractJson(text);
  const r = InvestigationOutputSchema.safeParse(json);
  if (!r.success) throw new AiOutputError(`The model reply does not match the schema: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 'schema');
  return r.data;
}

/** A claim stands only if it cites at least one id and EVERY id it cites is in the bundle. */
export function citationsHold(evidence: readonly string[], known: ReadonlySet<string>): boolean {
  return evidence.length > 0 && evidence.every((id) => known.has(id));
}

/** Drop the uncited. Returns what survives, renumbered, and how much was dropped (shown to the user: silence about it would hide the model's error rate). */
export function enforceCitations(output: InvestigationOutput, bundle: Pick<EvidenceBundle, 'items'>): CitedResult {
  const known = new Set(bundle.items.map((i) => i.id));
  let droppedClaims = 0;
  const keep = (c: { text: string; evidence: string[] }): CitedClaim | null => {
    const text = cleanText(c.text, { max: 500, free: true });
    if (!text || !citationsHold(c.evidence, known)) { droppedClaims += 1; return null; }
    return { text, evidence: [...new Set(c.evidence)] };
  };
  const summary = output.summary.map(keep).filter((c): c is CitedClaim => c !== null);
  const hypotheses: CitedHypothesis[] = [];
  let droppedHypotheses = 0;
  for (const h of output.hypotheses) {
    const claims = h.claims.map(keep).filter((c): c is CitedClaim => c !== null);
    const title = cleanText(h.title, { max: 160, free: true });
    if (claims.length === 0 || !title) { droppedHypotheses += 1; continue; }
    hypotheses.push({ rank: hypotheses.length + 1, title, confidence: h.confidence, claims });
  }
  return { summary, hypotheses, dropped: { claims: droppedClaims, hypotheses: droppedHypotheses } };
}

/** Is a stored or rendered result free of uncited claims? Used by the renderer and by the evaluation runner as an invariant. */
export function everyClaimResolves(result: Pick<CitedResult, 'summary' | 'hypotheses'>, bundle: Pick<EvidenceBundle, 'items'>): boolean {
  const known = new Set(bundle.items.map((i) => i.id));
  return [...result.summary, ...result.hypotheses.flatMap((h) => h.claims)].every((c) => citationsHold(c.evidence, known));
}
