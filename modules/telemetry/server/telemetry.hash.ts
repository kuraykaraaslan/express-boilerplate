import { createHash } from 'node:crypto';

/**
 * Per-message idempotency (00 P0-T-20, OD-144): `msgHash` is the first 8 bytes of SHA-1 over the record's canonical data (object
 * keys sorted at every depth, arrays in order), read as a signed big-endian int8 so it fits the `int8` column. The primary key
 * `(tenantId, entityId, ts, msgHash)` then makes a replay of the same stream entry, and a device's QoS 1 re-send of the same
 * payload at the same `ts`, one row, while two different messages at one `ts` (two topics, OD-25) are both kept.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    // `-0` and `0` are one number in JSON; a value JSON cannot hold never reaches here (the rules drop it first)
    const text = JSON.stringify(Object.is(v, -0) ? 0 : v);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** The `msgHash` of a record's values, as the decimal text of a signed int8 (what the `pg` driver sends and returns). */
export function msgHashOf(values: Readonly<Record<string, unknown>>): string {
  const digest = createHash('sha1').update(canonicalJson(values)).digest();
  return digest.readBigInt64BE(0).toString();
}
