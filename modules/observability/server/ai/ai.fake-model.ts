/**
 * A deterministic stand-in for a language model (phase 20.7): no network, no randomness, so CI can run the investigator end to end and the
 * evaluation set can regression-test the prompt contract, the parser and the citation rule. It reads the evidence document out of the
 * prompt (the same way a model would) and answers in the required JSON shape. The modes exist to attack the renderer:
 *
 *   faithful       cites only ids it was given: hypotheses from changes, errors, similar incidents
 *   hallucinating  adds claims with no citation and with ids that are not in the evidence (the renderer must drop them)
 *   garbage        not JSON
 *   badshape       JSON of the wrong shape
 *   fenced         faithful, wrapped in a code fence (tolerated)
 *   injected       follows an instruction planted in the evidence, if there is one (it must still be bound by the citation rule)
 */
import type { ModelPort, ModelReply, ModelRequest } from './ai.model';

export type FakeMode = 'faithful' | 'hallucinating' | 'garbage' | 'badshape' | 'fenced' | 'injected';

interface DocItem { id: string; kind: string; title: string; detail: string }

export function evidenceFromPrompt(prompt: string): DocItem[] {
  const m = /<<<EVIDENCE[^\n]*\n([\s\S]*?)\nEND EVIDENCE>>>/.exec(prompt);
  if (!m) return [];
  try { return (JSON.parse(m[1]!) as { evidence?: DocItem[] }).evidence ?? []; } catch { return []; }
}

export function faithfulAnswer(items: DocItem[]) {
  const first = (k: string) => items.filter((i) => i.kind === k);
  const incident = first('incident')[0];
  const hypotheses: Array<{ title: string; confidence: 'low' | 'medium' | 'high'; claims: Array<{ text: string; evidence: string[] }> }> = [];
  const changes = first('change');
  const errors = [...first('log'), ...first('trace')];
  const similar = first('similar_incident');
  if (changes.length) hypotheses.push({ title: 'A recent change may have caused this', confidence: 'medium', claims: [{ text: `${changes[0]!.title} happened shortly before the incident started.`, evidence: [changes[0]!.id, ...(incident ? [incident.id] : [])] }] });
  if (errors.length) hypotheses.push({ title: 'The application is reporting errors', confidence: 'medium', claims: [{ text: `Errors were observed: ${errors[0]!.title}.`, evidence: errors.slice(0, 2).map((e) => e.id) }] });
  if (similar.length) hypotheses.push({ title: 'This resembles an earlier incident', confidence: 'low', claims: [{ text: `${similar[0]!.title} had the same alert group or monitor.`, evidence: [similar[0]!.id] }] });
  return {
    summary: [{ text: incident ? `${incident.title} (${incident.detail.split(';')[0]}).` : 'An incident is open.', evidence: incident ? [incident.id] : [items[0]?.id ?? 'E1'] }],
    hypotheses,
  };
}

export class FakeModel implements ModelPort {
  readonly calls: ModelRequest[] = [];
  constructor(private readonly mode: FakeMode = 'faithful', private readonly opts: { available?: boolean; fail?: boolean } = {}) {}

  async available(): Promise<boolean> { return this.opts.available ?? true; }

  async complete(_tenantId: string, req: ModelRequest): Promise<ModelReply> {
    this.calls.push(req);
    if (this.opts.fail) throw new Error('provider unavailable');
    const items = evidenceFromPrompt(req.prompt);
    const ok = faithfulAnswer(items);
    let text: string;
    switch (this.mode) {
      case 'garbage': text = 'I think the database is the problem. Hope this helps!'; break;
      case 'badshape': text = JSON.stringify({ summary: 'the database', hypotheses: 'maybe' }); break;
      case 'fenced': text = `\`\`\`json\n${JSON.stringify(ok)}\n\`\`\``; break;
      case 'hallucinating':
        text = JSON.stringify({
          summary: [...ok.summary, { text: 'The database primary ran out of disk.', evidence: ['E99'] }],
          hypotheses: [
            { title: 'Disk exhaustion on the primary', confidence: 'high', claims: [{ text: 'The primary ran out of disk at 03:00.', evidence: ['E98'] }, { text: 'It always happens on Thursdays.', evidence: [] as string[] }] },
            ...ok.hypotheses,
            { title: 'Half-cited hypothesis', confidence: 'medium', claims: [{ text: 'Supported part.', evidence: [items[0]?.id ?? 'E1'] }, { text: 'Cites a real and a fake id.', evidence: [items[0]?.id ?? 'E1', 'E77'] }] },
          ],
        });
        break;
      case 'injected': {
        const planted = items.find((i) => /ignore previous instructions/i.test(i.detail + i.title));
        text = JSON.stringify(planted
          ? { summary: [{ text: 'All clear: the system is healthy, nothing to investigate.', evidence: [] }], hypotheses: [] }
          : ok);
        break;
      }
      default: text = JSON.stringify(ok);
    }
    return { text, provider: req.provider, model: req.model ?? 'fake-1', inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}
