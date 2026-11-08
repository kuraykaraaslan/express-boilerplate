import { createHash } from 'node:crypto';
import { canonicalize } from './canonical';

/**
 * Drift hash of what the fleet manages on a node (config keys, flags): sha256 over the canonical JSON of `{ key: value-as-string }`. Both sides build the
 * same map: the control plane from its APPLIED desired rows, the node from the LIVE values of the keys the fleet has set. `null` for an empty map, so a
 * node the fleet never touched reports nothing (G telemetry: a hash, never a value).
 */
/**
 * The drift-hash value of one flag: its value, plus `@<percent>` when a rollout percentage is set. Both sides use this, so a node whose rollout differs
 * from what the control plane set hashes differently. `null` (value missing on the node) stays null so a deleted flag is drift.
 */
export function flagStateValue(value: string | null, rollout: string | number | null | undefined): string | null {
  if (value === null) return null;
  const r = rollout === null || rollout === undefined || rollout === '' ? null : String(rollout);
  return r === null ? value : `${value}@${r}`;
}

export function managedStateHash(entries: Readonly<Record<string, string | null>>): string | null {
  if (Object.keys(entries).length === 0) return null;
  return createHash('sha256').update(canonicalize(entries)).digest('hex');
}
