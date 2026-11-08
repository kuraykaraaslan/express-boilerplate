import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalize } from './canonical';
import type { GResult } from './g.schema';

/**
 * How a node answers `compliance.check` inside its `G` result (docs/phases/02-fleet/08 section 7, roadmap Phase 7: "results ingest, status codes +
 * evidence hash only"). The command names the checks (`checkIds`, at most 50); the answer carries, per requested check and BY ITS POSITION in that
 * list, one status and optionally the sha256 of the evidence the node keeps locally (`fleet_local_check_results`). No check id, message or detail
 * travels back: an index, an enum value and a hash are all the control plane learns.
 *
 *   counts.C00 .. C49   the status of checkIds[i] as its index in CHECK_STATUSES
 *   hashes.E00 .. E49   the evidence hash of checkIds[i], when the node has one
 *   counts.PASS / WARN / FAIL / SKIPPED / ERROR   the totals, which must agree with the slots
 *
 * `code` is OK when every requested check was judged (PASS, WARN or FAIL) and PARTIAL when one was SKIPPED (the node does not implement it) or ERRORed.
 * A FAIL is an outcome, not a failed command. Decoding fails closed on anything inconsistent: a missing or extra slot, an unknown status, totals that
 * do not add up, a hash for a check that was not asked.
 */
export const CHECK_STATUSES = ['PASS', 'WARN', 'FAIL', 'SKIPPED', 'ERROR'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const CheckStatusSchema = z.enum(CHECK_STATUSES);

/** A check id as the catalogue names it (`audit.chain_ok`, `cert.expiry_gt_14d`). */
export const CHECK_ID_RE = /^[a-z][a-z0-9_.]{0,63}$/;
/** `compliance.check` takes at most this many ids (the catalogue schema), so two digits index every slot. */
export const MAX_CHECKS_PER_COMMAND = 50;

const SHA256 = /^[a-f0-9]{64}$/;
const statusSlot = (i: number): string => `C${String(i).padStart(2, '0')}`;
const evidenceSlot = (i: number): string => `E${String(i).padStart(2, '0')}`;
const STATUS_SLOT_RE = /^C(\d{2})$/;
const EVIDENCE_SLOT_RE = /^E(\d{2})$/;

export interface CheckOutcome {
  status: CheckStatus;
  /** sha256 (hex) of the node-local evidence of this run; absent = the node keeps none. */
  evidenceHash?: string;
}

/**
 * Builds the result body fields for `checkIds` from the node's outcomes (keyed by check id). A requested check without an outcome is SKIPPED;
 * an outcome for a check that was not requested is ignored. Throws on a malformed request (the node never answers a command it could not parse).
 */
export function encodeCheckResults(checkIds: readonly string[], outcomes: Readonly<Record<string, CheckOutcome>>): Required<Pick<GResult, 'code' | 'counts'>> & Pick<GResult, 'hashes'> {
  assertCheckIds(checkIds);
  const counts: Record<string, number> = { PASS: 0, WARN: 0, FAIL: 0, SKIPPED: 0, ERROR: 0 };
  const hashes: Record<string, string> = {};
  checkIds.forEach((id, i) => {
    const o = Object.prototype.hasOwnProperty.call(outcomes, id) ? outcomes[id] : undefined;
    const status: CheckStatus = o && (CHECK_STATUSES as readonly string[]).includes(o.status) ? o.status : 'SKIPPED';
    counts[statusSlot(i)] = CHECK_STATUSES.indexOf(status);
    counts[status] += 1;
    if (o?.evidenceHash !== undefined) {
      if (!SHA256.test(o.evidenceHash)) throw new Error(`evidence of ${id} is not a sha256`);
      hashes[evidenceSlot(i)] = o.evidenceHash;
    }
  });
  const code = counts.SKIPPED + counts.ERROR > 0 ? 'PARTIAL' : 'OK';
  return { code, counts, ...(Object.keys(hashes).length ? { hashes } : {}) };
}

export interface DecodedCheck { checkId: string; status: CheckStatus; evidenceHash: string | null }
export type DecodeVerdict = { ok: true; checks: DecodedCheck[] } | { ok: false; reason: 'BAD_REQUEST' | 'BAD_CODE' | 'MISSING_SLOT' | 'EXTRA_SLOT' | 'BAD_STATUS' | 'TOTALS_MISMATCH' | 'BAD_EVIDENCE' };

/** Reads a node's answer back against the ids the command asked for (the control plane's own copy of the payload, never the node's echo). */
export function decodeCheckResults(checkIds: readonly string[], result: { code?: string; counts?: Record<string, number>; hashes?: Record<string, string> }): DecodeVerdict {
  try { assertCheckIds(checkIds); } catch { return { ok: false, reason: 'BAD_REQUEST' }; }
  if (result.code !== 'OK' && result.code !== 'PARTIAL') return { ok: false, reason: 'BAD_CODE' };
  const counts = result.counts ?? {};
  const hashes = result.hashes ?? {};
  const totals: Record<CheckStatus, number> = { PASS: 0, WARN: 0, FAIL: 0, SKIPPED: 0, ERROR: 0 };
  const checks: DecodedCheck[] = [];
  for (const [i, checkId] of checkIds.entries()) {
    const v = counts[statusSlot(i)];
    if (v === undefined) return { ok: false, reason: 'MISSING_SLOT' };
    if (!Number.isSafeInteger(v) || v < 0 || v >= CHECK_STATUSES.length) return { ok: false, reason: 'BAD_STATUS' };
    const status = CHECK_STATUSES[v]!;
    totals[status] += 1;
    const h = hashes[evidenceSlot(i)];
    if (h !== undefined && !SHA256.test(h)) return { ok: false, reason: 'BAD_EVIDENCE' };
    checks.push({ checkId, status, evidenceHash: h ?? null });
  }
  for (const k of Object.keys(counts)) {
    const m = STATUS_SLOT_RE.exec(k);
    if (m ? Number(m[1]) >= checkIds.length : !(CHECK_STATUSES as readonly string[]).includes(k)) return { ok: false, reason: 'EXTRA_SLOT' };
  }
  for (const k of Object.keys(hashes)) {
    const m = EVIDENCE_SLOT_RE.exec(k);
    if (!m || Number(m[1]) >= checkIds.length) return { ok: false, reason: 'EXTRA_SLOT' };
  }
  for (const s of CHECK_STATUSES) if ((counts[s] ?? 0) !== totals[s]) return { ok: false, reason: 'TOTALS_MISMATCH' };
  const partial = totals.SKIPPED + totals.ERROR > 0;
  if ((result.code === 'PARTIAL') !== partial) return { ok: false, reason: 'BAD_CODE' };
  return { ok: true, checks };
}

function assertCheckIds(checkIds: readonly string[]): void {
  if (checkIds.length === 0 || checkIds.length > MAX_CHECKS_PER_COMMAND) throw new Error('compliance.check names 1 to 50 checks');
  if (new Set(checkIds).size !== checkIds.length) throw new Error('compliance.check names a check twice');
  for (const id of checkIds) if (!CHECK_ID_RE.test(id)) throw new Error('malformed check id');
}

/** sha256 (hex) of the canonical form of what a check looked at: the evidence a node could show an auditor; only this hash ever leaves the node. */
export const evidenceHash = (details: Record<string, unknown>): string => createHash('sha256').update(canonicalize(details)).digest('hex');

