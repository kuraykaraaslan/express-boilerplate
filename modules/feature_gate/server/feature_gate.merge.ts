// The union of what several live entitlement sources grant (feature_gate.service.ts), pure so the catalogue's own previews
// (tenant_subscription's revoke impact) merge with the same rule.
import type { EntitlementState } from './feature_gate.types';
import { parseLimitValue } from './feature_gate.limit-value';

/**
 * The union of what several live arrangements grant, one entry per key.
 *
 * Until 2026-10-17 the features were concatenated and the FIRST entry for a key won, so with two sources the answer
 * depended on contribution order: a tenant whose catalogue plan includes custom domains could be refused by an older
 * subscription plan that did not. "Additive" (the point's contract) means the most generous answer: a BOOLEAN is true
 * when any source grants it, a LIMIT is unlimited (-1) when any source says so and otherwise the highest ceiling. Two
 * entries of different types for one key keep the first; that is a catalogue error, not something to guess at.
 *
 * A LIMIT marked `additive` (a usage pack, phase 53.9, D170) is not a ceiling of its own: every such row adds its value to
 * that most generous ceiling, once per row (two packs held, two rows). It adds only to a LIMIT some arrangement declares: on
 * its own it would turn an undeclared quota, which nothing limits, into a cap. On an unlimited ceiling it changes nothing,
 * and an unlimited pack makes the ceiling unlimited.
 */
export function mergeFeatures(features: EntitlementState['features']): EntitlementState['features'] {
  const byKey = new Map<string, EntitlementState['features'][number]>();
  const added = new Map<string, number>();
  for (const f of features) {
    if (f.additive && f.type === 'LIMIT') {
      const v = parseLimitValue(f.value);
      const sum = added.get(f.key) ?? 0;
      if (v === -1 || sum === -1) added.set(f.key, -1);
      else if (Number.isFinite(v) && v > 0) added.set(f.key, sum + v);
      continue;
    }
    const seen = byKey.get(f.key);
    if (!seen) { byKey.set(f.key, f); continue; }
    if (seen.type !== f.type) continue;
    if (f.type === 'BOOLEAN') {
      if (seen.value !== 'true' && f.value === 'true') byKey.set(f.key, f);
    } else {
      const a = parseLimitValue(seen.value);
      const b = parseLimitValue(f.value);
      if (a === -1) continue;
      if (b === -1 || (Number.isFinite(b) && (!Number.isFinite(a) || b > a))) byKey.set(f.key, f);
    }
  }
  for (const [key, extra] of added) {
    const base = byKey.get(key);
    if (!base || base.type !== 'LIMIT') continue;
    const ceiling = parseLimitValue(base.value);
    if (ceiling === -1 || !Number.isFinite(ceiling)) continue;
    byKey.set(key, { key, type: 'LIMIT', value: extra === -1 ? '-1' : String(ceiling + extra) });
  }
  return [...byKey.values()];
}
