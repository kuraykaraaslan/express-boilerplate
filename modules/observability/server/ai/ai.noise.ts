/**
 * The noise assistant (phase 20.4): offline analysis of the alert history that SUGGESTS how to make the pipeline quieter. Pure statistics over
 * stored alerts, no model and no network: the same history always gives the same suggestions. It never applies anything: a suggestion is data
 * (what it saw, why it matters, what a rule would look like) and a person decides, in the routes and silences screens that already exist.
 *
 * What it looks for, in order of how safe the advice is:
 *   flapping   the same alert fires and clears by itself within minutes, again and again  -> hold it for a few minutes before announcing (threshold / for-duration)
 *   scheduled  the same alert fires at the same hour every day                            -> a recurring maintenance window or a silence for that hour
 *   unattended the same alert fires often and nobody ever acknowledges it or opens an incident -> lower its severity or stop routing it
 *   burst      alerts of different kinds start within minutes of each other and share a label  -> group them by that label, one announcement instead of many
 */
import { createHash } from 'node:crypto';
import { cleanText } from '../hygiene';

export interface NoiseAlert {
  alertId: string; title: string; source: string; severity: string; status: string; startsAt: Date | string; endsAt?: Date | string | null;
  labels: Record<string, string>; groupKey?: string | null; acknowledgedAt?: Date | string | null; incidentId?: string | null;
}

export type NoiseKind = 'flapping' | 'scheduled' | 'unattended' | 'burst';

export interface NoiseSuggestion {
  id: string;
  kind: NoiseKind;
  title: string;
  rationale: string;
  stats: { alerts: number; windowDays: number; sampleAlertIds: string[] };
  /** What a rule would look like. Data only: nothing here is applied. */
  proposal: { type: 'hold' | 'silence_window' | 'severity' | 'group_by'; [k: string]: unknown };
  estimatedAlertsSavedPerWeek: number;
}

export interface NoiseOptions { windowDays: number; now: Date; minOccurrences: number }
export const DEFAULT_NOISE: Omit<NoiseOptions, 'now'> = { windowDays: 14, minOccurrences: 5 };
const MIN = 60_000;

const ms = (d: Date | string) => new Date(d).getTime();
const sid = (kind: string, key: string) => createHash('sha256').update(`${kind}|${key}`).digest('hex').slice(0, 12);
const perWeek = (n: number, days: number) => Math.round((n / days) * 7);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };
const label = (a: NoiseAlert) => cleanText(a.labels?.alertname ?? a.title, { max: 80, free: true });
const keyOf = (a: NoiseAlert) => `${a.source}|${a.labels?.alertname ?? a.title}`;

export function analyzeNoise(alerts: readonly NoiseAlert[], partial: Partial<NoiseOptions> & { now: Date }): NoiseSuggestion[] {
  const o: NoiseOptions = { ...DEFAULT_NOISE, ...partial };
  const since = o.now.getTime() - o.windowDays * 86_400_000;
  const recent = alerts.filter((a) => ms(a.startsAt) >= since && ms(a.startsAt) <= o.now.getTime());
  const out: NoiseSuggestion[] = [];

  const groups = new Map<string, NoiseAlert[]>();
  for (const a of recent) { const k = keyOf(a); (groups.get(k) ?? groups.set(k, []).get(k)!).push(a); }

  for (const [key, list] of groups) {
    if (list.length < o.minOccurrences) continue;
    const name = label(list[0]!);
    const sample = list.slice(0, 3).map((a) => a.alertId);
    const durations = list.filter((a) => a.status === 'RESOLVED' && a.endsAt).map((a) => (ms(a.endsAt!) - ms(a.startsAt)) / MIN).filter((d) => d >= 0);

    // flapping: most resolved quickly, on their own
    if (durations.length >= o.minOccurrences && median(durations) <= 5 && !list.some((a) => a.incidentId)) {
      const hold = Math.min(15, Math.ceil(pct(durations, 0.9)) + 1);
      out.push({
        id: sid('flapping', key), kind: 'flapping', title: `"${name}" clears by itself`,
        rationale: `It fired ${list.length} times in ${o.windowDays} days and cleared on its own within ${Math.round(median(durations) * 10) / 10} minutes (median). Holding it for ${hold} minutes before announcing would have avoided most of them.`,
        stats: { alerts: list.length, windowDays: o.windowDays, sampleAlertIds: sample }, proposal: { type: 'hold', alertname: name, holdMinutes: hold },
        estimatedAlertsSavedPerWeek: perWeek(durations.filter((d) => d < hold).length, o.windowDays),
      });
      continue;
    }

    // scheduled: one per day-ish, always the same hour
    const hours = new Map<number, number>();
    for (const a of list) { const h = new Date(ms(a.startsAt)).getUTCHours(); hours.set(h, (hours.get(h) ?? 0) + 1); }
    const [topHour, topCount] = [...hours.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const days = new Set(list.filter((a) => new Date(ms(a.startsAt)).getUTCHours() === topHour).map((a) => new Date(ms(a.startsAt)).toISOString().slice(0, 10)));
    if (topCount >= o.minOccurrences && topCount / list.length >= 0.8 && days.size >= Math.ceil(o.windowDays * 0.5)) {
      out.push({
        id: sid('scheduled', key), kind: 'scheduled', title: `"${name}" fires around ${String(topHour).padStart(2, '0')}:00 UTC every day`,
        rationale: `${topCount} of its ${list.length} firings in ${o.windowDays} days started in the same hour, on ${days.size} different days. That looks like a scheduled job or backup, not a fault.`,
        stats: { alerts: list.length, windowDays: o.windowDays, sampleAlertIds: sample }, proposal: { type: 'silence_window', alertname: name, startHourUtc: topHour, durationMinutes: 60, recurring: 'daily' },
        estimatedAlertsSavedPerWeek: perWeek(topCount, o.windowDays),
      });
      continue;
    }

    // unattended: frequent, never acknowledged, never an incident
    if (list.length >= o.minOccurrences * 2 && !list.some((a) => a.acknowledgedAt || a.incidentId)) {
      out.push({
        id: sid('unattended', key), kind: 'unattended', title: `"${name}" is never acted on`,
        rationale: `It fired ${list.length} times in ${o.windowDays} days and nobody acknowledged it or opened an incident for it. Either it does not matter (lower its severity or stop routing it) or it matters and is being missed.`,
        stats: { alerts: list.length, windowDays: o.windowDays, sampleAlertIds: sample }, proposal: { type: 'severity', alertname: name, to: 'INFO' },
        estimatedAlertsSavedPerWeek: perWeek(list.length, o.windowDays),
      });
    }
  }

  // bursts: different alert kinds starting within 5 minutes of each other that share a label value
  const sorted = [...recent].sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  const bursts: NoiseAlert[][] = [];
  for (const a of sorted) {
    const last = bursts[bursts.length - 1];
    if (last && ms(a.startsAt) - ms(last[last.length - 1]!.startsAt) <= 5 * MIN) last.push(a); else bursts.push([a]);
  }
  const byLabel = new Map<string, { bursts: number; alerts: number; groupKeys: Set<string>; sample: string[] }>();
  for (const b of bursts.filter((x) => x.length >= 4 && new Set(x.map(keyOf)).size >= 2)) {
    const counts = new Map<string, number>();
    for (const a of b) for (const [k, v] of Object.entries(a.labels ?? {})) if (k !== 'alertname' && v) counts.set(`${k}\u0000${v}`, (counts.get(`${k}\u0000${v}`) ?? 0) + 1);
    const seenLabels = new Set<string>();
    for (const [kv, n] of counts) {
      if (n < 4) continue;
      const k = kv.split('\u0000')[0]!;
      if (seenLabels.has(k)) continue;
      seenLabels.add(k);
      const e = byLabel.get(k) ?? { bursts: 0, alerts: 0, groupKeys: new Set<string>(), sample: [] };
      e.bursts += 1; e.alerts += n;
      for (const a of b) if (a.groupKey) e.groupKeys.add(a.groupKey);
      if (e.sample.length < 3) e.sample.push(b[0]!.alertId);
      byLabel.set(k, e);
    }
  }
  for (const [k, e] of byLabel) {
    if (e.bursts < 3 || e.groupKeys.size < 2) continue;
    out.push({
      id: sid('burst', k), kind: 'burst', title: `Group alerts by "${cleanText(k, { max: 40 })}"`,
      rationale: `${e.bursts} times in ${o.windowDays} days, at least four alerts of different kinds started within minutes of each other and shared the same "${cleanText(k, { max: 40 })}", yet they were announced in ${e.groupKeys.size} separate groups. Grouping by that label would turn each burst into one announcement.`,
      stats: { alerts: e.alerts, windowDays: o.windowDays, sampleAlertIds: e.sample }, proposal: { type: 'group_by', groupBy: [k] },
      estimatedAlertsSavedPerWeek: perWeek(e.alerts - e.bursts, o.windowDays),
    });
  }
  return out.sort((a, b) => b.estimatedAlertsSavedPerWeek - a.estimatedAlertsSavedPerWeek || a.id.localeCompare(b.id)).slice(0, 20);
}
