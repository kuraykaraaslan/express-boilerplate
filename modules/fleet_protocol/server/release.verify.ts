import { verify, sign, type KeyObject } from 'node:crypto';
import { canonicalBytes } from './canonical';
import { ReleaseManifestSchema, type ReleaseManifest } from './release.manifest.schema';

/**
 * Release verification (docs/phases/02-fleet 03 section 8.5, 04 section 8.4): a release is deployable only when
 * (1) its manifest is schema-valid with every image pinned by digest, (2) CI provenance vouches for exactly those
 * digests, and (3) a non-revoked RELEASE_MANAGER key signed the (version, channel, manifest, ciProvenanceRef) tuple.
 * Pure: no I/O; the provenance check is an injected port.
 */
export interface SignedRelease {
  version: string;
  channel: string;
  manifest: unknown;
  ciProvenanceRef: string;
  humanSignature: string;
  humanSignerKeyId: string;
}

export type ReleaseDecision =
  | 'REJECTED_SCHEMA'
  | 'REJECTED_DIGEST_PIN'
  | 'REJECTED_DUPLICATE_TARGET'
  | 'REJECTED_SIGNER'
  | 'REJECTED_SIGNATURE'
  | 'REJECTED_PROVENANCE'
  | 'REJECTED_CHANNEL'
  | 'REJECTED_NOT_PINNED'
  | 'REJECTED_AGENT_VERSION'
  | 'REJECTED_PROTOCOL';

export type ReleaseResult = { ok: true; manifest: ReleaseManifest; version: string; channel: string } | { ok: false; decision: ReleaseDecision };

export interface ReleaseManagerKey {
  publicKey: KeyObject;
  revoked?: boolean;
}

export interface ReleaseVerifyContext {
  releaseManagerKeys: ReadonlyMap<string, ReleaseManagerKey>;
  /** True only if CI provenance `ref` attests exactly these `target -> digest` pairs. Must fail closed. */
  verifyProvenance: (ref: string, images: ReadonlyArray<{ target: string; digest: string }>) => boolean;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
/** Registry reference charset: no quotes, `$`, backticks, `;`, `{}` or control chars that could break out of a compose template or shell. */
const SAFE_IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9._\/:@-]*$/;

function releaseSignedBytes(r: Pick<SignedRelease, 'version' | 'channel' | 'ciProvenanceRef'> & { manifest: unknown }): Buffer {
  return canonicalBytes({ version: r.version, channel: r.channel, manifest: r.manifest, ciProvenanceRef: r.ciProvenanceRef });
}

/** Release-manager side (CI/tooling and tests): sign the release tuple. */
export function signRelease(
  r: { version: string; channel: string; manifest: ReleaseManifest; ciProvenanceRef: string },
  privateKey: KeyObject,
): string {
  return sign(null, releaseSignedBytes(r), privateKey).toString('base64url');
}

/** Every image must be pinned: a digest field, and when the ref embeds `@sha256:` it must agree. Tag-only refs are fine only alongside the digest. */
export function checkDigestPins(manifest: ReleaseManifest): ReleaseDecision | null {
  const targets = new Set<string>();
  for (const img of manifest.images) {
    if (targets.has(img.target)) return 'REJECTED_DUPLICATE_TARGET';
    targets.add(img.target);
    const at = img.ref.indexOf('@');
    if (at !== -1 && img.ref.slice(at + 1) !== img.digest) return 'REJECTED_DIGEST_PIN';
    if (!SAFE_IMAGE_REF.test(img.ref)) return 'REJECTED_DIGEST_PIN';
  }
  return null;
}

export function verifyRelease(raw: SignedRelease, ctx: ReleaseVerifyContext): ReleaseResult {
  // A frame from a peer is untyped JSON: a non-string header field (e.g. an object whose own `toString` is not callable) would make
  // RegExp.test throw on coercion, so every header field must be a string before anything reads it.
  const header = [raw?.version, raw?.channel, raw?.ciProvenanceRef, raw?.humanSignature, raw?.humanSignerKeyId];
  if (!header.every((v) => typeof v === 'string')) return { ok: false, decision: 'REJECTED_SCHEMA' };
  if (!SEMVER.test(raw.version) || !/^[A-Z_]{1,32}$/.test(raw.channel)) return { ok: false, decision: 'REJECTED_SCHEMA' };
  if (!raw.ciProvenanceRef || raw.ciProvenanceRef.length > 1024) return { ok: false, decision: 'REJECTED_SCHEMA' };
  const parsed = ReleaseManifestSchema.safeParse(raw.manifest);
  if (!parsed.success) return { ok: false, decision: 'REJECTED_SCHEMA' };
  const manifest = parsed.data;
  const pin = checkDigestPins(manifest);
  if (pin) return { ok: false, decision: pin };

  const key = ctx.releaseManagerKeys.get(raw.humanSignerKeyId);
  if (!key || key.revoked) return { ok: false, decision: 'REJECTED_SIGNER' };
  if (!/^[A-Za-z0-9_-]{86}$/.test(raw.humanSignature)) return { ok: false, decision: 'REJECTED_SIGNATURE' };
  const sig = Buffer.from(raw.humanSignature, 'base64url');
  if (sig.length !== 64 || sig.toString('base64url') !== raw.humanSignature) return { ok: false, decision: 'REJECTED_SIGNATURE' };
  let good = false;
  try {
    good = verify(null, releaseSignedBytes({ ...raw, manifest }), key.publicKey, sig);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, decision: 'REJECTED_SIGNATURE' };

  let provenanceOk = false;
  try {
    provenanceOk = ctx.verifyProvenance(raw.ciProvenanceRef, manifest.images) === true;
  } catch {
    provenanceOk = false;
  }
  if (!provenanceOk) return { ok: false, decision: 'REJECTED_PROVENANCE' };
  return { ok: true, manifest, version: raw.version, channel: raw.channel };
}

export interface ReleaseAdmission {
  version: string;
  channel: string;
  manifest: ReleaseManifest;
  agentVersion: string;
  protocolVersion: number;
  /** Effective policy: allowed channels (empty = none). */
  allowedReleaseChannels: readonly string[];
  /** Regional operator pins; undefined = the region does not require pinning. */
  approvedReleases?: readonly string[];
}

/** True for the SemVer 2.0 subset the fleet uses (`major.minor.patch[-prerelease]`, no leading zeros, no build metadata). */
export function isSemver(v: string): boolean {
  return SEMVER.test(v);
}

/**
 * SemVer 2.0 precedence (BigInt cores, so huge numbers cannot collapse to equal doubles; a pre-release sorts below its release).
 * -1 / 0 / 1, NaN when either side is unparsable: callers compare with `>= 0` / `<= 0` so NaN fails closed.
 */
export function compareSemver(a: string, b: string): number {
  const x = SEMVER.exec(a), y = SEMVER.exec(b);
  if (!x || !y) return NaN;
  for (let i = 1; i <= 3; i++) {
    const d = BigInt(x[i]) - BigInt(y[i]);
    if (d !== BigInt(0)) return d < BigInt(0) ? -1 : 1;
  }
  const pa = x[4], pb = y[4];
  if (pa === undefined && pb === undefined) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  const A = pa.split('.'), B = pb.split('.');
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const na = /^\d+$/.test(A[i]), nb = /^\d+$/.test(B[i]);
    if (na && nb) {
      const d = BigInt(A[i]) - BigInt(B[i]);
      if (d !== BigInt(0)) return d < BigInt(0) ? -1 : 1;
    } else if (na !== nb) return na ? -1 : 1;
    else if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  }
  return A.length === B.length ? 0 : A.length < B.length ? -1 : 1;
}

/** Node-side admission of an already verified release: channel policy, regional pin, agent and protocol compatibility. Fails closed on unparsable versions. */
export function checkReleaseAdmission(a: ReleaseAdmission): ReleaseDecision | null {
  if (!a.allowedReleaseChannels.includes(a.channel)) return 'REJECTED_CHANNEL';
  if (a.approvedReleases && !a.approvedReleases.includes(a.version)) return 'REJECTED_NOT_PINNED';
  const lo = compareSemver(a.agentVersion, a.manifest.minAgentVersion);
  if (!(lo >= 0)) return 'REJECTED_AGENT_VERSION';
  if (a.manifest.maxAgentVersion !== undefined) {
    const hi = compareSemver(a.agentVersion, a.manifest.maxAgentVersion);
    if (!(hi <= 0)) return 'REJECTED_AGENT_VERSION';
  }
  if (!a.manifest.protocolVersions.includes(a.protocolVersion)) return 'REJECTED_PROTOCOL';
  return null;
}
