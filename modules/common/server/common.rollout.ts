import { createHash } from 'node:crypto'

/**
 * The ONE rollout hash. `feature_flags` buckets a flag's percentage rollout with it and `tenant` buckets a canary
 * maintenance window with it (locked decision: no second rollout hash), so it lives in `common` and neither imports
 * the other (docs/phases/37-extensions/10, 2026-10-17 second pass).
 *
 * Its own file, not `common.rules`: that one is pure and reaches client bundles (form_builder's logic editor), and
 * `node:crypto` must not follow it there.
 *
 * Deterministic rollout bucket in [0,100) for a (key, subject) pair. The same subject always lands in the same bucket
 * for a given key, so raising a percentage only ever *adds* subjects: nobody flips off as the rollout grows. Different
 * keys bucket independently (the key is part of the hash).
 */
export function rolloutBucket(key: string, subject: string): number {
  const digest = createHash('sha256').update(`${key}:${subject}`).digest()
  // First 4 bytes -> unsigned 32-bit int -> modulo 100.
  const n = digest.readUInt32BE(0)
  return n % 100
}
