import { exportPublicKey, importPublicKey } from './sign';
import type { ReleaseManagerKey } from './release.verify';
import type { ReleaseSourcePins } from './release.signed';
import {
  ReleaseKeySlotSchema, ReleaseSourceSchema, type ReleaseKeySlot, type ReleaseSource, type TrustBundleContent,
} from './trust-bundle';

/**
 * Release trust inside the trust bundle (07 §5.1, 04 §8.4): CI provenance keys, RELEASE_MANAGER keys and the source pin, plus the
 * pure helpers around them. The control plane uses the builder, check and diff when it publishes a bundle; a node or `fleet-deployd`
 * uses `releaseTrustFromBundle` to get the inputs of `verifySignedRelease` out of a bundle it has already verified.
 * No I/O, no clock: callers pass `now`.
 */

export type ReleaseTrustSlots = Partial<Pick<TrustBundleContent, 'ciKeys' | 'releaseManagerKeys' | 'releaseSources'>>;

const byKid = (a: { kid: string }, b: { kid: string }) => (a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0);
const sourceKey = (s: ReleaseSource) => JSON.stringify([s.repo, s.workflow, s.refPrefix ?? null]);

/**
 * The optional bundle fields for `slots`, validated and sorted (so equal input gives equal bytes), and ONLY the non-empty ones:
 * spread the result into the bundle content. An all-empty input gives `{}`, which keeps the bundle readable by agents that
 * predate these fields. Throws (ZodError) on a malformed entry.
 */
export function releaseTrustFields(slots: { ciKeys?: readonly ReleaseKeySlot[]; releaseManagerKeys?: readonly ReleaseKeySlot[]; releaseSources?: readonly ReleaseSource[] }): ReleaseTrustSlots {
  const out: ReleaseTrustSlots = {};
  for (const slot of ['ciKeys', 'releaseManagerKeys'] as const) {
    const keys = slots[slot] ?? [];
    if (keys.length) out[slot] = keys.map((k) => ReleaseKeySlotSchema.parse(k)).sort(byKid);
  }
  const sources = slots.releaseSources ?? [];
  if (sources.length) out.releaseSources = sources.map((s) => ReleaseSourceSchema.parse(s)).sort((a, b) => (sourceKey(a) < sourceKey(b) ? -1 : 1));
  return out;
}

export type ReleaseTrustProblem =
  | 'DUPLICATE_CI_KID' | 'DUPLICATE_RELEASE_MANAGER_KID' | 'DUPLICATE_PUBLIC_KEY' | 'KEY_IN_BOTH_ROLES' | 'DUPLICATE_SOURCE' | 'INVALID_PUBLIC_KEY';
export type ReleaseTrustWarning = 'FEWER_THAN_TWO_ACTIVE_RELEASE_MANAGER_KEYS' | 'NO_ACTIVE_CI_KEY' | 'RELEASE_KEYS_WITHOUT_RELEASE_MANAGER_KEYS';

// An unparsable `notAfter` (NaN) is NOT active: the comparison is written so NaN fails closed.
const isActive = (k: ReleaseKeySlot, now: number): boolean => !k.revoked && (!k.notAfter || Date.parse(k.notAfter) > now * 1000);

function dupes(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

// A raw Ed25519 key has two ignored padding bits in its last base64url character, so one key has several spellings: compare
// the re-exported form (an unparsable key keeps its own spelling; INVALID_PUBLIC_KEY refuses it anyway).
function keyId(k: ReleaseKeySlot): string {
  try { return exportPublicKey(importPublicKey(k.publicKey)); } catch { return k.publicKey; }
}

function parsesAsKey(k: ReleaseKeySlot): boolean {
  try { importPublicKey(k.publicKey); return true; } catch { return false; }
}

/**
 * Problems refuse a publish; warnings are shown and may be acknowledged. A bundle with problems is also refused by
 * `releaseTrustFromBundle`, so it can never half-apply on a node. `now` is unix seconds.
 */
export function checkReleaseTrust(content: ReleaseTrustSlots, now: number): { problems: ReleaseTrustProblem[]; warnings: ReleaseTrustWarning[] } {
  const ci = content.ciKeys ?? [], rm = content.releaseManagerKeys ?? [], sources = content.releaseSources ?? [];
  const problems = new Set<ReleaseTrustProblem>();
  if (dupes(ci.map((k) => k.kid))) problems.add('DUPLICATE_CI_KID');
  if (dupes(rm.map((k) => k.kid))) problems.add('DUPLICATE_RELEASE_MANAGER_KID');
  const ciIds = ci.map(keyId), rmIds = rm.map(keyId);
  if (dupes(ciIds) || dupes(rmIds)) problems.add('DUPLICATE_PUBLIC_KEY');
  // verifySignedRelease refuses a CI key equal to the approver's key at runtime; refuse it at publish too (any state, so a key cannot be parked in the other role).
  const rmKeys = new Set(rmIds);
  if (ciIds.some((id) => rmKeys.has(id))) problems.add('KEY_IN_BOTH_ROLES');
  if (dupes(sources.map(sourceKey))) problems.add('DUPLICATE_SOURCE');
  if ([...ci, ...rm].some((k) => !parsesAsKey(k))) problems.add('INVALID_PUBLIC_KEY');

  const warnings: ReleaseTrustWarning[] = [];
  const activeRm = rm.filter((k) => isActive(k, now)).length;
  if (rm.length && activeRm < 2) warnings.push('FEWER_THAN_TWO_ACTIVE_RELEASE_MANAGER_KEYS');
  if (ci.length && !ci.some((k) => isActive(k, now))) warnings.push('NO_ACTIVE_CI_KEY');
  if (ci.length && !rm.length) warnings.push('RELEASE_KEYS_WITHOUT_RELEASE_MANAGER_KEYS');
  return { problems: [...problems], warnings };
}

export interface SlotDiff {
  added: string[];
  removed: string[];
  /** Present in both and newly flagged `revoked` (passing `notAfter` is not a change of the bundle, so it is not listed). */
  revoked: string[];
  reinstated: string[];
  /** Same kid, different public key: a key must never change under a kid; treat as a problem. */
  rekeyed: string[];
}
export interface ReleaseTrustDiff { ciKeys: SlotDiff; releaseManagerKeys: SlotDiff; sources: { added: ReleaseSource[]; removed: ReleaseSource[] } }

function diffSlot(prev: readonly ReleaseKeySlot[], next: readonly ReleaseKeySlot[]): SlotDiff {
  const p = new Map(prev.map((k) => [k.kid, k])), n = new Map(next.map((k) => [k.kid, k]));
  const d: SlotDiff = { added: [], removed: [], revoked: [], reinstated: [], rekeyed: [] };
  for (const [kid, k] of n) {
    const old = p.get(kid);
    if (!old) { d.added.push(kid); continue; }
    if (old.publicKey !== k.publicKey) d.rekeyed.push(kid);
    if (!old.revoked && k.revoked) d.revoked.push(kid);
    if (old.revoked && !k.revoked) d.reinstated.push(kid);
  }
  for (const kid of p.keys()) if (!n.has(kid)) d.removed.push(kid);
  for (const list of Object.values(d)) list.sort();
  return d;
}

/** What changes between two bundles' release trust (`prev` null = first bundle). For the publish diff the operator reviews. */
export function diffReleaseTrust(prev: ReleaseTrustSlots | null, next: ReleaseTrustSlots): ReleaseTrustDiff {
  const old = prev ?? {};
  const was = new Map((old.releaseSources ?? []).map((s) => [sourceKey(s), s])), is = new Map((next.releaseSources ?? []).map((s) => [sourceKey(s), s]));
  return {
    ciKeys: diffSlot(old.ciKeys ?? [], next.ciKeys ?? []),
    releaseManagerKeys: diffSlot(old.releaseManagerKeys ?? [], next.releaseManagerKeys ?? []),
    sources: { added: [...is].filter(([k]) => !was.has(k)).map(([, s]) => s), removed: [...was].filter(([k]) => !is.has(k)).map(([, s]) => s) },
  };
}

export type ReleaseTrustResult =
  | { ok: true; ciKeys: Map<string, ReleaseManagerKey>; releaseManagerKeys: Map<string, ReleaseManagerKey>; allowedSources?: ReleaseSourcePins }
  | { ok: false; reason: ReleaseTrustProblem };

function toKeyMap(keys: readonly ReleaseKeySlot[], now: number, ignoreExpiry: boolean): Map<string, ReleaseManagerKey> {
  // A key past `notAfter` stays in the map as revoked, so a lookup names it as unusable instead of "unknown".
  // `ignoreExpiry` drops only the `notAfter` test: a key flagged `revoked` is unusable either way.
  return new Map(keys.map((k) => [k.kid, { publicKey: importPublicKey(k.publicKey), revoked: ignoreExpiry ? k.revoked === true : !isActive(k, now) }]));
}

/**
 * The `ciKeys` / `releaseManagerKeys` / `allowedSources` inputs of `verifySignedRelease` from a bundle that was ALREADY verified
 * (signature and version are not checked here). Fails closed: any problem `checkReleaseTrust` names (duplicate kid, a key in both
 * roles, an unparsable key) yields `ok: false` and no keys at all. A bundle without these fields yields empty maps, under which
 * every release is refused, and `allowedSources` undefined (no source pin). `now` is unix seconds.
 *
 * `options.ignoreExpiry` is for a release that is already installed and is put back or restarted (decision 23): a key past its
 * `notAfter` still verifies, a REVOKED key never does. Without it (the default) an expired key is unusable.
 */
export function releaseTrustFromBundle(content: ReleaseTrustSlots, now: number, options: { ignoreExpiry?: boolean } = {}): ReleaseTrustResult {
  const { problems } = checkReleaseTrust(content, now);
  if (problems.length) return { ok: false, reason: problems[0] };
  return {
    ok: true,
    ciKeys: toKeyMap(content.ciKeys ?? [], now, options.ignoreExpiry === true),
    releaseManagerKeys: toKeyMap(content.releaseManagerKeys ?? [], now, options.ignoreExpiry === true),
    allowedSources: content.releaseSources?.map((s) => ({ ...s })),
  };
}
