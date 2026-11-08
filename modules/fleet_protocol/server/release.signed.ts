import { createHash, type KeyObject } from 'node:crypto';
import { canonicalBytes } from './canonical';
import { documentSigningBytes, signDocument, verifyDocument } from './document';
import { exportPublicKey } from './sign';
import { checkDigestPins, isSemver, type ReleaseDecision, type ReleaseManagerKey } from './release.verify';
import {
  DoublySignedReleaseSchema, ProvenanceAttestationSchema, ReleaseApprovalSchema, ReleaseApprovalStatementSchema, ReleaseManifestSchema,
  type ProvenanceAttestation, type ProvenanceStatement, type ReleaseApproval, type ReleaseApprovalStatement, type ReleaseManifest,
} from './release.manifest.schema';

/**
 * Doubly-signed release verification (07 section 5.1, 04 section 8.4): CI provenance attestation AND a RELEASE_MANAGER signature,
 * both checked here with keys the caller supplies (trust bundle). Self-contained: no injected provenance port, no I/O.
 * Ed25519 over domain-separated canonical JSON (`document.ts`), so neither signature verifies as the other, as an envelope or in
 * the old flat `verifyRelease` form.
 *
 * Three entry points share the same checks:
 *  - `verifyProvenanceOnly`: the CI half, for DRAFT admission on the control plane (a draft has no approval yet);
 *  - `verifyApprovalAgainst`: the release manager half, for the publish step (the approval must cover exactly this draft);
 *  - `verifySignedRelease`: both halves together, the final gate. The control plane runs it again at publish and a node
 *    runs it before every deploy; the half verifiers never replace it.
 */
export const PROVENANCE_DOMAIN = 'fleet.release.provenance';
export const APPROVAL_DOMAIN = 'fleet.release.approval';
const DEFAULT_SKEW_SECONDS = 60;

export type SignedReleaseDecision =
  | ReleaseDecision
  | 'REJECTED_NO_PROVENANCE'
  | 'REJECTED_NO_APPROVAL'
  | 'REJECTED_PROVENANCE_KID'
  | 'REJECTED_SAME_KEY'
  | 'REJECTED_EXPIRED'
  | 'REJECTED_NOT_YET_VALID'
  /** The approval is validly signed but for another version or channel than the draft it is applied to. */
  | 'REJECTED_APPROVAL_MISMATCH';

export type ReleaseSourcePins = ReadonlyArray<{ repo: string; workflow: string; refPrefix?: string }>;

export interface DoublySignedReleaseContext {
  /** CI provenance keys by kid (the CI attestation identity). */
  ciKeys: ReadonlyMap<string, ReleaseManagerKey>;
  /** RELEASE_MANAGER keys by kid. */
  releaseManagerKeys: ReadonlyMap<string, ReleaseManagerKey>;
  /** Unix seconds. */
  now: number;
  /** Allowance for a signing time slightly ahead of this clock (default 60 s). */
  skewSeconds?: number;
  /**
   * Where a build may come from (07 section 5.1: built from `repo@ref` by workflow X). When given, the attested `repo` and
   * `workflow` must equal an entry and, if the entry has `refPrefix`, the `ref` must start with it. Omitted = no source pin
   * (the human signature is then the only judge of the source). An empty list matches nothing.
   */
  allowedSources?: ReleaseSourcePins;
  /**
   * Skip the `exp` of both signatures (the not-yet-valid check stays). For a release that is ALREADY installed on the node and is put
   * back (rollback) or restarted: expiry bounds when a release may start to be deployed, not how long it may keep running (07 section
   * 5.1 d, decision 23). Signatures, key revocation, bindings and the source pin are enforced exactly as without it.
   */
  ignoreExpiry?: boolean;
}

export type DoublySignedReleaseResult =
  | { ok: true; manifest: ReleaseManifest; version: string; channel: string; manifestHash: string; ciKid: string; approverKid: string }
  | { ok: false; decision: SignedReleaseDecision };

const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** sha256 (hex) of the canonical manifest: what both parties bind to. */
export function manifestHash(manifest: unknown): string {
  return sha256Hex(canonicalBytes(manifest));
}

/** sha256 (hex) of the whole canonical attestation (kid, statement, sig): what the release manager's signature binds to. */
export function attestationHash(attestation: Pick<ProvenanceAttestation, 'kid' | 'statement' | 'sig'>): string {
  return sha256Hex(canonicalBytes({ kid: attestation.kid, statement: attestation.statement, sig: attestation.sig }));
}

/** CI side (and tests): sign a provenance statement. */
export function signProvenanceAttestation(i: { kid: string; statement: ProvenanceStatement }, privateKey: KeyObject): ProvenanceAttestation {
  return { kid: i.kid, statement: i.statement, sig: signDocument(PROVENANCE_DOMAIN, i.statement, privateKey) };
}

/** Release manager side (the `fleet-release sign` tooling and tests): sign the approval statement. */
export function signReleaseApproval(i: { kid: string; statement: ReleaseApprovalStatement }, privateKey: KeyObject): ReleaseApproval {
  return { kid: i.kid, statement: i.statement, sig: signDocument(APPROVAL_DOMAIN, i.statement, privateKey) };
}

/** What a draft carries before it is approved (03 section 8.5: `{ version, channel, manifest, provenance }`). */
export interface ReleaseDraft {
  version: string;
  channel: string;
  manifest: ReleaseManifest;
  provenance: ProvenanceAttestation;
}

/**
 * The statement a release manager signs for `draft`, built from the draft alone so the server, the CLI and the UI show and sign
 * the same document. `signedAt` and `exp` (unix seconds) are the signer's choice and must satisfy the bounded lifetime
 * (`MAX_RELEASE_SIGNATURE_TTL_SECONDS`). Throws (ZodError) on a malformed draft or lifetime; it does NOT verify the draft:
 * run `verifyProvenanceOnly` first.
 */
export function approvalStatementFor(draft: ReleaseDraft, when: { signedAt: number; exp: number }): ReleaseApprovalStatement {
  const manifest = ReleaseManifestSchema.parse(draft.manifest);
  const provenance = ProvenanceAttestationSchema.parse(draft.provenance);
  return ReleaseApprovalStatementSchema.parse({
    v: 1, version: draft.version, channel: draft.channel,
    manifestHash: manifestHash(manifest), provenanceHash: attestationHash(provenance),
    signedAt: when.signedAt, exp: when.exp,
  });
}

/** The exact bytes an Ed25519 signer (hardware token, external signer command) signs for `statement`; the signature is base64url. */
export function approvalSigningBytes(statement: ReleaseApprovalStatement): Buffer {
  return documentSigningBytes(APPROVAL_DOMAIN, ReleaseApprovalStatementSchema.parse(statement));
}

/** Wraps a signature produced elsewhere (over `approvalSigningBytes`) into an approval. Throws (ZodError) on a malformed result; verification is separate. */
export function assembleReleaseApproval(i: { kid: string; statement: ReleaseApprovalStatement; sig: string }): ReleaseApproval {
  return ReleaseApprovalSchema.parse({ kid: i.kid, statement: i.statement, sig: i.sig });
}

const fail = (decision: SignedReleaseDecision): { ok: false; decision: SignedReleaseDecision } => ({ ok: false, decision });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const present = (v: unknown): boolean => v !== undefined && v !== null;

function sameImages(a: ReadonlyArray<{ target: string; digest: string }>, b: ReadonlyArray<{ target: string; digest: string }>): boolean {
  if (a.length !== b.length) return false;
  const want = new Map(b.map((i) => [i.target, i.digest]));
  return want.size === b.length && a.every((i) => want.get(i.target) === i.digest);
}

/** The CI statement binds this manifest: its hash and exactly its `target -> digest` set. */
function provenanceBindsManifest(provenance: ProvenanceAttestation, manifest: ReleaseManifest, hash: string): boolean {
  return provenance.statement.manifestHash === hash && sameImages(provenance.statement.images, manifest.images);
}

function sourceAllowed(st: ProvenanceStatement, allowed: ReleaseSourcePins): boolean {
  return allowed.some((a) => a.repo === st.repo && a.workflow === st.workflow && (a.refPrefix === undefined || st.ref.startsWith(a.refPrefix)));
}

/** `exp` is exclusive; a start time may be at most `skew` seconds ahead of `now`. */
function timeDecision(
  parts: ReadonlyArray<{ start: number; exp: number }>, now: number, skew: number, ignoreExpiry = false,
): 'REJECTED_EXPIRED' | 'REJECTED_NOT_YET_VALID' | null {
  if (!ignoreExpiry && parts.some((p) => p.exp <= now)) return 'REJECTED_EXPIRED';
  if (parts.some((p) => p.start > now + skew)) return 'REJECTED_NOT_YET_VALID';
  return null;
}

/**
 * Order: shape (a missing half is named: CI-only or human-only is refused), manifest schema (incl. the migration contract) and
 * digest pins, key lookup and key separation, CI signature, human signature, bindings (manifest hash, digest set, attestation hash),
 * then the optional source pin, then time. Returns the SIGNED version and channel so admission cannot use unsigned values.
 */
export function verifySignedRelease(raw: unknown, ctx: DoublySignedReleaseContext): DoublySignedReleaseResult {
  if (!isRecord(raw)) return fail('REJECTED_SCHEMA');
  if (!present(raw.provenance)) return fail('REJECTED_NO_PROVENANCE');
  if (!present(raw.approval)) return fail('REJECTED_NO_APPROVAL');
  const parsed = DoublySignedReleaseSchema.safeParse(raw);
  if (!parsed.success) return fail('REJECTED_SCHEMA');
  const { manifest, provenance, approval } = parsed.data;

  const pin = checkDigestPins(manifest);
  if (pin) return fail(pin);

  const ciKey = ctx.ciKeys.get(provenance.kid);
  if (!ciKey || ciKey.revoked) return fail('REJECTED_PROVENANCE_KID');
  const rmKey = ctx.releaseManagerKeys.get(approval.kid);
  if (!rmKey || rmKey.revoked) return fail('REJECTED_SIGNER');
  // One key holding both roles would collapse 2-of-2 into 1-of-1.
  if (exportPublicKey(ciKey.publicKey) === exportPublicKey(rmKey.publicKey)) return fail('REJECTED_SAME_KEY');

  if (!verifyDocument(PROVENANCE_DOMAIN, provenance.statement, provenance.sig, ciKey.publicKey)) return fail('REJECTED_PROVENANCE');
  if (!verifyDocument(APPROVAL_DOMAIN, approval.statement, approval.sig, rmKey.publicKey)) return fail('REJECTED_SIGNATURE');

  const hash = manifestHash(manifest);
  if (!provenanceBindsManifest(provenance, manifest, hash)) return fail('REJECTED_PROVENANCE');
  if (approval.statement.manifestHash !== hash) return fail('REJECTED_SIGNATURE');
  if (approval.statement.provenanceHash !== attestationHash(provenance)) return fail('REJECTED_SIGNATURE');
  if (ctx.allowedSources && !sourceAllowed(provenance.statement, ctx.allowedSources)) return fail('REJECTED_PROVENANCE');

  const late = timeDecision(
    [{ start: provenance.statement.builtAt, exp: provenance.statement.exp }, { start: approval.statement.signedAt, exp: approval.statement.exp }],
    ctx.now, ctx.skewSeconds ?? DEFAULT_SKEW_SECONDS, ctx.ignoreExpiry,
  );
  if (late) return fail(late);

  return {
    ok: true, manifest, version: approval.statement.version, channel: approval.statement.channel,
    manifestHash: hash, ciKid: provenance.kid, approverKid: approval.kid,
  };
}

export interface ProvenanceOnlyContext {
  ciKeys: ReadonlyMap<string, ReleaseManagerKey>;
  now: number;
  skewSeconds?: number;
  allowedSources?: ReleaseSourcePins;
}

export type ProvenanceOnlyResult =
  | { ok: true; manifest: ReleaseManifest; provenance: ProvenanceAttestation; manifestHash: string; provenanceHash: string; ciKid: string }
  | { ok: false; decision: SignedReleaseDecision };

/**
 * DRAFT admission (03 section 8.5): the CI half alone. Checks the manifest schema and digest pins, a known and non-revoked CI key,
 * the CI signature, that the statement binds this manifest hash and exactly its `target -> digest` set, the optional source pin and
 * expiry. A pass only means "CI vouches for this manifest": the result is NOT deployable (`verifySignedRelease` still refuses it for
 * the missing approval) and carries no version or channel, because nothing signed those yet.
 */
export function verifyProvenanceOnly(provenance: unknown, manifest: unknown, ctx: ProvenanceOnlyContext): ProvenanceOnlyResult {
  if (!present(provenance)) return fail('REJECTED_NO_PROVENANCE');
  const m = ReleaseManifestSchema.safeParse(manifest);
  const p = ProvenanceAttestationSchema.safeParse(provenance);
  if (!m.success || !p.success) return fail('REJECTED_SCHEMA');

  const pin = checkDigestPins(m.data);
  if (pin) return fail(pin);
  const ciKey = ctx.ciKeys.get(p.data.kid);
  if (!ciKey || ciKey.revoked) return fail('REJECTED_PROVENANCE_KID');
  if (!verifyDocument(PROVENANCE_DOMAIN, p.data.statement, p.data.sig, ciKey.publicKey)) return fail('REJECTED_PROVENANCE');

  const hash = manifestHash(m.data);
  if (!provenanceBindsManifest(p.data, m.data, hash)) return fail('REJECTED_PROVENANCE');
  if (ctx.allowedSources && !sourceAllowed(p.data.statement, ctx.allowedSources)) return fail('REJECTED_PROVENANCE');
  const late = timeDecision([{ start: p.data.statement.builtAt, exp: p.data.statement.exp }], ctx.now, ctx.skewSeconds ?? DEFAULT_SKEW_SECONDS);
  if (late) return fail(late);

  return { ok: true, manifest: m.data, provenance: p.data, manifestHash: hash, provenanceHash: attestationHash(p.data), ciKid: p.data.kid };
}

export interface ApprovalContext {
  /** What the stored draft says; the approval must have been signed for exactly these. */
  version: string;
  channel: string;
  manifest: unknown;
  provenance: unknown;
  /** Needed for key separation: the approver must not hold the CI key of `provenance.kid`. */
  ciKeys: ReadonlyMap<string, ReleaseManagerKey>;
  releaseManagerKeys: ReadonlyMap<string, ReleaseManagerKey>;
  now: number;
  skewSeconds?: number;
}

export type ApprovalAgainstResult =
  | { ok: true; manifestHash: string; provenanceHash: string; ciKid: string; approverKid: string }
  | { ok: false; decision: SignedReleaseDecision };

/**
 * Publish step (03 section 8.5): the release manager half checked against the stored draft. The approval must verify under a known,
 * non-revoked RELEASE_MANAGER key that is not the CI key, be unexpired, and bind this draft's version, channel, manifest hash and
 * the hash of THIS provenance (swapping the CI half after review breaks it). It does not re-check the CI signature: the caller
 * runs `verifyProvenanceOnly` for that, and `verifySignedRelease` as the final gate before anything is marked published.
 */
export function verifyApprovalAgainst(approval: unknown, ctx: ApprovalContext): ApprovalAgainstResult {
  if (!present(approval)) return fail('REJECTED_NO_APPROVAL');
  if (!present(ctx.provenance)) return fail('REJECTED_NO_PROVENANCE');
  const a = ReleaseApprovalSchema.safeParse(approval);
  const m = ReleaseManifestSchema.safeParse(ctx.manifest);
  const p = ProvenanceAttestationSchema.safeParse(ctx.provenance);
  if (!a.success || !m.success || !p.success) return fail('REJECTED_SCHEMA');
  if (!isSemver(ctx.version) || !/^[A-Z_]{1,32}$/.test(ctx.channel)) return fail('REJECTED_SCHEMA');

  const ciKey = ctx.ciKeys.get(p.data.kid);
  if (!ciKey || ciKey.revoked) return fail('REJECTED_PROVENANCE_KID');
  const rmKey = ctx.releaseManagerKeys.get(a.data.kid);
  if (!rmKey || rmKey.revoked) return fail('REJECTED_SIGNER');
  if (exportPublicKey(ciKey.publicKey) === exportPublicKey(rmKey.publicKey)) return fail('REJECTED_SAME_KEY');
  if (!verifyDocument(APPROVAL_DOMAIN, a.data.statement, a.data.sig, rmKey.publicKey)) return fail('REJECTED_SIGNATURE');

  const hash = manifestHash(m.data);
  const provHash = attestationHash(p.data);
  if (a.data.statement.manifestHash !== hash || a.data.statement.provenanceHash !== provHash) return fail('REJECTED_SIGNATURE');
  if (a.data.statement.version !== ctx.version || a.data.statement.channel !== ctx.channel) return fail('REJECTED_APPROVAL_MISMATCH');
  // The human signed this attestation, but nothing yet says CI attested THIS manifest: a draft whose halves do not belong together is refused here too.
  if (!provenanceBindsManifest(p.data, m.data, hash)) return fail('REJECTED_PROVENANCE');
  const late = timeDecision([{ start: a.data.statement.signedAt, exp: a.data.statement.exp }], ctx.now, ctx.skewSeconds ?? DEFAULT_SKEW_SECONDS);
  if (late) return fail(late);

  return { ok: true, manifestHash: hash, provenanceHash: provHash, ciKid: p.data.kid, approverKid: a.data.kid };
}
