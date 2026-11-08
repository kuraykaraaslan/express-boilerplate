import { createHash, sign as cryptoSign, verify as cryptoVerify, X509Certificate, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalBytes, canonicalize } from './canonical';
import { signDocument, verifyDocument } from './document';
import { importPublicKey } from './sign';
import { CosignAssertionSchema, CosignRpSchema, verifyCosignAssertion, type CosignRp } from './cosign';
import { isFleetIdIssuer } from './fleet-id';

/**
 * Trust bundle (docs/phases/02-fleet/03 §8.2, 04 §Rotation): the control plane's public keys, CA chain, operator
 * co-sign keys, region list and (optionally) release trust, as `{ version, content, sig, kid }` where `content` is the canonical-JSON string
 * that was signed (so a verifier never re-serialises). Rules enforced here:
 *  - later bundles verify against a bundle key the node already pinned, and the version only moves forward;
 *  - the FIRST bundle has no pinned key, so it is authenticated through the CA chain: the chain must end in a
 *    self-signed root whose fingerprint equals the operator-supplied pin, and the signing `kid` must carry an
 *    attestation (ECDSA signature by the chain's issuing certificate over the key) that verifies.
 */
export const TRUST_BUNDLE_DOMAIN = 'fleet.trust-bundle';
/** Domain of the hash co-sign endorsements are made over. */
export const COSIGN_SECTION_DOMAIN = 'fleet.cosign-section';
/** What the offline root signs to endorse a co-sign section on its own (the recovery path of 04 "Co-sign key set changes"). */
export const COSIGN_ROOT_DOMAIN = 'fleet.cosign-section-root';
/** k of k-of-n: never fewer than two people may change who approves class-3 commands. */
export const MIN_COSIGN_THRESHOLD = 2;
export const MAX_COSIGN_THRESHOLD = 16;
/** How the people of a region log in (12 section 3): only with a Fleet ID account, either, or only locally. Part of the region's entry in the bundle. */
export const CENTRAL_IDENTITY_MODES = ['required', 'optional', 'forbidden'] as const;
export type CentralIdentityMode = (typeof CENTRAL_IDENTITY_MODES)[number];
/** The largest bundle content installers read (the agent's and the node app's request limits): a builder never emits more. */
export const MAX_TRUST_BUNDLE_CONTENT_BYTES = 131072;
/** How many past co-sign changes a bundle carries (`cosignChain`): an installer at most this many changes behind verifies the latest bundle directly. */
export const MAX_COSIGN_CHAIN = 4;
export const ATTESTATION_DOMAIN = 'fleet.trust-bundle-key';

const B64URL = /^[A-Za-z0-9_-]+$/;
const Kid = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
const OperatorCosignKeysSchema = z.array(z.object({ id: z.string().min(1).max(256), publicKey: z.string().max(1024) }).strict()).max(64);
const CosignThresholdSchema = z.number().int().min(MIN_COSIGN_THRESHOLD).max(MAX_COSIGN_THRESHOLD);
const CosignEpochSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const CosignEndorsementsSchema = z.array(z.object({ credentialId: z.string().min(1).max(256).regex(B64URL), assertion: CosignAssertionSchema }).strict()).min(1).max(MAX_COSIGN_THRESHOLD);
const RootEndorsementSchema = z.string().min(16).max(1024).regex(B64URL);
/** A co-sign section as `cosignSectionOf` returns it (nulls, not absent fields), as the chain carries it. */
export const CosignSectionSchema = z.object({
  operatorCosignKeys: OperatorCosignKeysSchema, cosignRp: CosignRpSchema.nullable(), cosignThreshold: CosignThresholdSchema.nullable(), cosignEpoch: CosignEpochSchema.nullable(),
}).strict();
const RawKey = z.string().length(43).regex(B64URL); // Ed25519 public key, raw, base64url

/**
 * A signing key the bundle distributes for release verification (`ciKeys`, `releaseManagerKeys`): same shape as a command key.
 * `notAfter` and `revoked` are honoured fail-closed by `releaseTrustFromBundle` (trust-bundle.release.ts).
 */
export const ReleaseKeySlotSchema = z.object({ kid: Kid, publicKey: RawKey, notAfter: z.string().datetime().optional(), revoked: z.boolean().optional() }).strict();
export type ReleaseKeySlot = z.infer<typeof ReleaseKeySlotSchema>;

/** One build source a release may come from (the `allowedSources` pin of `verifySignedRelease`). */
export const ReleaseSourceSchema = z.object({
  repo: z.string().min(1).max(256), workflow: z.string().min(1).max(256), refPrefix: z.string().min(1).max(256).optional(),
}).strict();
export type ReleaseSource = z.infer<typeof ReleaseSourceSchema>;

export const TrustBundleContentSchema = z.object({
  v: z.literal(1),
  version: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  /** PEM certificates, issuing intermediate first, self-signed root last. */
  caChainPem: z.array(z.string().max(8192)).min(1).max(5),
  /** Keys that may sign commands (`kid` goes in the envelope). */
  commandKeys: z.array(z.object({ kid: Kid, publicKey: RawKey, notAfter: z.string().datetime().optional(), revoked: z.boolean().optional() }).strict()).max(16),
  /** Keys that may sign trust bundles; `attestation` is only needed by nodes that have not pinned one yet. */
  bundleKeys: z.array(z.object({ kid: Kid, publicKey: RawKey, attestation: z.string().max(512).optional(), revoked: z.boolean().optional() }).strict()).min(1).max(8),
  /** Operator co-sign credentials: `id` = WebAuthn credential id, `publicKey` = SPKI DER, both base64url (cosign.ts). */
  operatorCosignKeys: OperatorCosignKeysSchema,
  /** Relying party the co-sign assertions must be bound to; without it a node accepts no class-3 approvals. */
  cosignRp: CosignRpSchema.optional(),
  /**
   * Co-sign key governance (04 "Co-sign key set changes", Phase 9), OPTIONAL like the release trust fields (an older agent refuses a bundle carrying it):
   * once an installed bundle names `cosignThreshold` (k), a later bundle may change the co-sign section (`operatorCosignKeys`, `cosignRp`,
   * `cosignThreshold`) only with `cosignEndorsements` by at least k distinct credentials of the INSTALLED section, each a WebAuthn assertion over
   * `cosignSectionHash` of the new section. The control plane's bundle key alone can then no longer add an approver.
   */
  cosignThreshold: CosignThresholdSchema.optional(),
  cosignEndorsements: CosignEndorsementsSchema.optional(),
  /**
   * The co-sign section's epoch, part of the section and so of what endorsements sign: it rises with every change of a governed section and never
   * falls (`checkCosignSectionChange`), so endorsements given for an earlier section can never be replayed to bring it back (a key removed after
   * a compromise stays removed). Optional and emitted only once governance is used, like the fields above.
   */
  cosignEpoch: CosignEpochSchema.optional(),
  /**
   * The last co-sign changes before this bundle's section, oldest first, each the section it introduced with the endorsements that introduced it
   * (at most `MAX_COSIGN_CHAIN`). An installer that missed some of them (a node offline across two changes, a node app or host helper that was
   * down) walks from the section it holds through the chain, each step endorsed by keys it already trusts, so it can install the latest bundle
   * directly. Optional and emitted only when non-empty.
   */
  cosignChain: z.array(z.object({ section: CosignSectionSchema, endorsements: CosignEndorsementsSchema.optional(), rootEndorsement: RootEndorsementSchema.optional() }).strict()
    .refine((l) => l.endorsements !== undefined || l.rootEndorsement !== undefined, 'a link carries endorsements or a root endorsement')).min(1).max(MAX_COSIGN_CHAIN).optional(),
  /**
   * The offline root's endorsement of this bundle's co-sign section (`signCosignRootEndorsement`), the recovery path when fewer than k operators still
   * hold keys: it stands on its own, from any section an installer holds, as long as the epoch rises. Counted only when the root is not the issuing
   * CA the control plane signs with (a chain of at least two certificates), so the control plane alone can never make one. Optional.
   */
  cosignRootEndorsement: RootEndorsementSchema.optional(),
  /**
   * The fleet's region vocabulary (05 section 2). `centralIdentity` is the region's identity policy from the registry (12 section 3), so a node knows
   * whether people may hold local credentials on it; optional like the release-trust fields (an agent that predates it refuses a bundle carrying it).
   */
  regions: z.array(z.object({ regionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), zone: z.string().max(253).optional(), centralIdentity: z.enum(CENTRAL_IDENTITY_MODES).optional() }).strict()).max(64),
  /**
   * Release trust (07 §5.1, 04 §8.4), all OPTIONAL and omitted when empty: the schema is strict, so an agent that predates these
   * fields rejects any bundle carrying them (fail closed). Roll the agent schema out first; `releaseTrustFields` emits them only
   * when non-empty so bundles that do not use release trust stay readable by older agents.
   * `ciKeys`: CI provenance keys. `releaseManagerKeys`: RELEASE_MANAGER keys. `releaseSources`: the source pin (absent = no pin,
   * present = only these; never an empty array).
   */
  ciKeys: z.array(ReleaseKeySlotSchema).min(1).max(16).optional(),
  releaseManagerKeys: z.array(ReleaseKeySlotSchema).min(1).max(16).optional(),
  releaseSources: z.array(ReleaseSourceSchema).min(1).max(16).optional(),
  /**
   * Fleet ID (12 section 4.2, FID-07): the hub's issuer, where the people of a node log in. A node's client id is not here: it is derived from the
   * node id (`fleetIdClientId`, `node:<nodeId>`, the client the control plane registers with `identity.client.register`), so the bundle stays the
   * same bytes for every node. OPTIONAL like the release trust fields: an agent that predates it refuses a bundle carrying it, so the agents roll out
   * first and the control plane emits it only once `FLEET_ID_ISSUER` is configured.
   */
  fleetId: z.object({ issuer: z.string().refine(isFleetIdIssuer, 'not a Fleet ID issuer') }).strict().optional(),
  /**
   * The domain zones (docs/phases/02-fleet/14-zones-and-central-signup.md, F39): each entry domain with its region, the node new sign-ups are created on,
   * whether sign-up is open and the language a new organization starts with. A node checks a fleet-originated sign-up against it (F41) and keeps its
   * tenants' base domains inside its region's zones (F43). OPTIONAL like the fields above: an agent that predates it refuses a bundle carrying it, so the
   * agents roll out first and the control plane emits it only once a zone is registered.
   */
  zones: z.array(z.object({
    zoneId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    domain: z.string().min(4).max(253).regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/),
    regionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    entryNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    signupOpen: z.boolean(),
    defaultLocale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  }).strict()).min(1).max(64).optional(),
}).strict();
export type TrustBundleZone = NonNullable<z.infer<typeof TrustBundleContentSchema>['zones']>[number];
export type TrustBundleContent = z.infer<typeof TrustBundleContentSchema>;

export interface SignedTrustBundle { version: number; content: string; sig: string; kid: string }

export type TrustBundleDecision =
  | 'OK' | 'REJECTED_SCHEMA' | 'REJECTED_KID' | 'REJECTED_SIGNATURE' | 'REJECTED_VERSION' | 'REJECTED_VERSION_MISMATCH'
  | 'REJECTED_ROOT' | 'REJECTED_CHAIN' | 'REJECTED_ATTESTATION' | 'REJECTED_COSIGN_SECTION';

export function signTrustBundle(content: TrustBundleContent, kid: string, privateKey: KeyObject): SignedTrustBundle {
  const parsed = TrustBundleContentSchema.parse(content);
  return { version: parsed.version, content: canonicalize(parsed), sig: signDocument(TRUST_BUNDLE_DOMAIN, parsed, privateKey), kid };
}

/** Bytes a CA signs to vouch for a bundle signing key. Exported for CA keys that cannot leave a KMS / WebCrypto. */
export function attestationBytes(kid: string, publicKey: string): Buffer {
  return Buffer.concat([Buffer.from(`${ATTESTATION_DOMAIN}\0`, 'utf8'), canonicalBytes({ kid, publicKey })]);
}
/** ECDSA (DER, base64url) by the issuing CA key over `(kid, publicKey)`; run by the control plane when it mints a bundle key. */
export function attestBundleKey(kid: string, publicKey: string, caPrivateKey: KeyObject): string {
  return cryptoSign('sha256', attestationBytes(kid, publicKey), caPrivateKey).toString('base64url');
}

const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export const certFingerprint = (pem: string): string => sha256Hex(new X509Certificate(pem).raw);

function parse(bundle: SignedTrustBundle): { content: TrustBundleContent } | null {
  try {
    const content = TrustBundleContentSchema.parse(JSON.parse(bundle.content));
    // `content` must BE the canonical form, so what was signed is exactly what is read.
    if (canonicalize(content) !== bundle.content || content.version !== bundle.version) return null;
    return { content };
  } catch { return null; }
}

/**
 * The content of a bundle a caller ALREADY verified and kept (strict schema, canonical form, version in step with the wrapper), or
 * null. It checks no signature: `fleet-deployd` re-reads its own stored copy with this, and it is never the way to accept a bundle.
 */
export function parseVerifiedTrustBundle(bundle: SignedTrustBundle): TrustBundleContent | null {
  return parse(bundle)?.content ?? null;
}

function checkSignature(content: TrustBundleContent, bundle: SignedTrustBundle, key: KeyObject): boolean {
  return verifyDocument(TRUST_BUNDLE_DOMAIN, content, bundle.sig, key);
}

/** The co-sign section of a bundle: who may approve class-3 commands, for which relying party, how many must agree to change that, and its epoch. */
export interface CosignSection { operatorCosignKeys: TrustBundleContent['operatorCosignKeys']; cosignRp: CosignRp | null; cosignThreshold: number | null; cosignEpoch: number | null }
export type CosignFields = Pick<TrustBundleContent, 'operatorCosignKeys' | 'cosignRp' | 'cosignThreshold' | 'cosignEpoch'>;

/** The section, its keys in credential-id order (so a reordering is not a change). The endorsements are not part of what they endorse. */
export function cosignSectionOf(c: CosignFields): CosignSection {
  return {
    operatorCosignKeys: [...c.operatorCosignKeys].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), cosignRp: c.cosignRp ?? null,
    cosignThreshold: c.cosignThreshold ?? null, cosignEpoch: c.cosignEpoch ?? null,
  };
}

/** The bundle fields of a section (the inverse of `cosignSectionOf`): a null is an absent field, as the bundle emits it. */
export function cosignFieldsOf(s: CosignSection): CosignFields {
  return {
    operatorCosignKeys: s.operatorCosignKeys, ...(s.cosignRp ? { cosignRp: s.cosignRp } : {}),
    ...(s.cosignThreshold !== null ? { cosignThreshold: s.cosignThreshold } : {}), ...(s.cosignEpoch !== null ? { cosignEpoch: s.cosignEpoch } : {}),
  };
}

/** sha256 (hex) of the domain-separated canonical section: the challenge every endorsement signs. */
export function cosignSectionHash(s: CosignSection): string {
  return sha256Hex(Buffer.concat([Buffer.from(`${COSIGN_SECTION_DOMAIN}\0`, 'utf8'), canonicalBytes(s)]));
}

type CosignEndorsement = z.infer<typeof CosignEndorsementsSchema>[number];

/** The bytes the offline root signs to endorse a section: domain-separated from the operators' endorsements, the bundle and any certificate. */
export function cosignRootEndorsementBytes(s: CosignSection): Buffer {
  return Buffer.concat([Buffer.from(`${COSIGN_ROOT_DOMAIN}\0`, 'utf8'), canonicalBytes(s)]);
}
const digestFor = (key: KeyObject) => (key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448' ? null : 'sha256');
/** The offline root's endorsement of `s` (base64url; DER for ECDSA), made in the root ceremony with the root's private key. */
export function signCosignRootEndorsement(s: CosignSection, rootPrivateKey: KeyObject): string {
  return cryptoSign(digestFor(rootPrivateKey), cosignRootEndorsementBytes(s), rootPrivateKey).toString('base64url');
}
/** Whether `signature` is a signature of `s`'s root endorsement bytes by the key of the certificate `rootPem` (the ceremony checks what it made with this). */
export function verifyCosignRootSignature(rootPem: string, s: CosignSection, signature: string): boolean {
  try {
    const root = new X509Certificate(rootPem);
    return cryptoVerify(digestFor(root.publicKey), cosignRootEndorsementBytes(s), root.publicKey, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}
/** The fingerprint of the chain's root when it is an OFFLINE root (not also the issuing CA, whose key the control plane holds), or null. */
export function offlineRootFingerprint(caChainPem: readonly string[] | undefined): string | null {
  if (!caChainPem || caChainPem.length < 2) return null;
  try {
    const root = sha256Hex(new X509Certificate(caChainPem[caChainPem.length - 1]!).raw);
    return root === sha256Hex(new X509Certificate(caChainPem[0]!).raw) ? null : root;
  } catch { return null; }
}
/** Whether `signature` is the root's endorsement of `s`, the root being the last certificate of `caChainPem`. A chain without an offline root counts nothing. */
export function verifyCosignRootEndorsement(caChainPem: readonly string[] | undefined, s: CosignSection, signature: string): boolean {
  return offlineRootFingerprint(caChainPem) !== null && verifyCosignRootSignature(caChainPem![caChainPem!.length - 1]!, s, signature);
}

/** Whether k distinct credentials of `from` endorsed exactly `to`, each a WebAuthn assertion over its hash for `from`'s relying party. */
function endorsedBy(from: CosignSection, to: CosignSection, endorsements: readonly CosignEndorsement[] | undefined): boolean {
  if (!from.cosignRp || from.cosignThreshold === null) return false;
  const challengeHex = cosignSectionHash(to);
  const keys = new Map(from.operatorCosignKeys.map((k) => [k.id, k.publicKey]));
  const endorsed = new Set<string>();
  for (const e of endorsements ?? []) {
    const publicKeySpki = keys.get(e.credentialId);
    if (!publicKeySpki || endorsed.has(e.credentialId)) continue;
    if (verifyCosignAssertion({ assertion: e.assertion, challengeHex, rp: from.cosignRp, publicKeySpki }).ok) endorsed.add(e.credentialId);
  }
  return endorsed.size >= from.cosignThreshold;
}

/**
 * One step from section `from` to `to`. A threshold the new key set cannot meet is refused (no change could ever be endorsed again), and the epoch
 * never falls, whatever the governance state. Before governance is on (`from` names no threshold) the section is bootstrap trust and any other
 * change passes; after, an unchanged section passes, and a changed one must raise the epoch and carry endorsements by at least `from`'s k DISTINCT
 * credentials over `to` (epoch included), verified against `from`'s relying party: a key being added cannot endorse its own addition, removing
 * the threshold is a change too, and an endorsement once used can never count again (its epoch is behind).
 */
function cosignStep(from: CosignSection, to: CosignSection, endorsements: readonly CosignEndorsement[] | undefined, rootEndorsed = false): boolean {
  if (to.cosignThreshold !== null && to.cosignThreshold > to.operatorCosignKeys.length) return false;
  if ((to.cosignEpoch ?? 0) < (from.cosignEpoch ?? 0)) return false;
  if (from.cosignThreshold === null) return true;
  if (canonicalize(from) === canonicalize(to)) return true;
  if ((to.cosignEpoch ?? 0) <= (from.cosignEpoch ?? 0)) return false;
  return rootEndorsed || endorsedBy(from, to, endorsements);
}

/**
 * Whether `next` may replace the co-sign section of `current` (04 "Co-sign key set changes"): from the installed section, through the changes of
 * `next.cosignChain` it has not seen yet (a link whose epoch is not past the section reached is one it holds or one before it), to `next`'s own
 * section with `next.cosignEndorsements`, every step a `cosignStep`. The chain is the control plane's data, but every link it adds must be
 * endorsed by keys the installer already trusts, so it can only bridge, never inject.
 */
export function checkCosignSectionChange(current: CosignFields & { caChainPem?: readonly string[] }, next: TrustBundleContent): boolean {
  const steps = [
    ...(next.cosignChain ?? []).map((l) => ({
      section: cosignSectionOf({ ...l.section, cosignRp: l.section.cosignRp ?? undefined, cosignThreshold: l.section.cosignThreshold ?? undefined, cosignEpoch: l.section.cosignEpoch ?? undefined }),
      endorsements: l.endorsements, root: l.rootEndorsement,
    })),
    { section: cosignSectionOf(next), endorsements: next.cosignEndorsements, root: next.cosignRootEndorsement },
  ];
  const rooted = (i: number) => !!steps[i]!.root && verifyCosignRootEndorsement(current.caChainPem, steps[i]!.section, steps[i]!.root!);
  let from = cosignSectionOf(current);
  // A section the offline root endorsed stands on its own: the walk starts at the newest one past the installed epoch, so an installer further behind
  // than the chain reaches still gets there.
  let start = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if ((steps[i]!.section.cosignEpoch ?? 0) <= (from.cosignEpoch ?? 0) || !rooted(i)) continue;
    if (!cosignStep(from, steps[i]!.section, undefined, true)) return false;
    from = steps[i]!.section; start = i + 1;
    break;
  }
  for (let i = start; i < steps.length; i++) {
    const last = i === steps.length - 1;
    if (!last && (steps[i]!.section.cosignEpoch ?? 0) <= (from.cosignEpoch ?? 0)) continue;
    if (!cosignStep(from, steps[i]!.section, steps[i]!.endorsements, rooted(i))) return false;
    from = steps[i]!.section;
  }
  return true;
}

/**
 * The chain the bundle after `published` carries: `published`'s own chain plus the change `published` introduced (its section and endorsements, if it
 * carried any), the last `MAX_COSIGN_CHAIN` of them. Empty when there is nothing to carry.
 */
export function nextCosignChain(published: Pick<TrustBundleContent, 'cosignChain' | 'cosignEndorsements' | 'cosignRootEndorsement'> & CosignFields | null): NonNullable<TrustBundleContent['cosignChain']> {
  if (!published) return [];
  const introduced = published.cosignEndorsements || published.cosignRootEndorsement
    ? [{ section: cosignSectionOf(published), ...(published.cosignEndorsements ? { endorsements: published.cosignEndorsements } : {}), ...(published.cosignRootEndorsement ? { rootEndorsement: published.cosignRootEndorsement } : {}) }]
    : [];
  const links = [...(published.cosignChain ?? []), ...introduced];
  return links.slice(-MAX_COSIGN_CHAIN);
}

/**
 * `content` with as many of the newest `chain` links as keep it within `MAX_TRUST_BUNDLE_CONTENT_BYTES`, the oldest dropped first (none when none
 * fit): a bundle no installer can read helps nobody, and an installer further behind than the links kept needs the offline root instead.
 */
export function attachCosignChain(content: TrustBundleContent, chain: NonNullable<TrustBundleContent['cosignChain']>): TrustBundleContent {
  const { cosignChain: _old, ...rest } = content;
  void _old;
  for (let start = 0; start < chain.length; start++) {
    const withChain = { ...rest, cosignChain: chain.slice(start) };
    if (Buffer.byteLength(canonicalize(withChain), 'utf8') <= MAX_TRUST_BUNDLE_CONTENT_BYTES) return withChain;
  }
  return rest;
}

/** What identifies a root certificate: its sha256 fingerprint, or the text itself when it does not parse (a test stand-in), so equal means the same root. */
function rootIdentity(caChainPem: readonly string[]): string {
  const pem = caChainPem[caChainPem.length - 1] ?? '';
  try { return `sha256:${sha256Hex(new X509Certificate(pem).raw)}`; } catch { return `text:${pem.trim()}`; }
}

/**
 * A later bundle: signed by a bundle key the node already trusts (current bundle), strictly newer, under the SAME root (the one the node pinned when
 * it took its first bundle: a bundle key may rotate keys and intermediates under it, never move the root, which only an out-of-band re-pin may do),
 * and, once co-sign governance is on, changing the co-sign section only with the endorsements the current one requires (`checkCosignSectionChange`).
 * Every place that installs a bundle (agent, node app, host helper, the control plane's own publish) goes through this, so none accepts what another
 * would refuse.
 */
export function verifyTrustBundleUpdate(
  bundle: SignedTrustBundle, current: Pick<TrustBundleContent, 'version' | 'bundleKeys' | 'caChainPem'> & CosignFields,
): { decision: TrustBundleDecision; content?: TrustBundleContent } {
  const p = parse(bundle);
  if (!p) return { decision: 'REJECTED_SCHEMA' };
  if (p.content.version <= current.version) return { decision: 'REJECTED_VERSION' };
  const k = current.bundleKeys.find((x) => x.kid === bundle.kid);
  if (!k || k.revoked) return { decision: 'REJECTED_KID' };
  if (!checkSignature(p.content, bundle, importPublicKey(k.publicKey))) return { decision: 'REJECTED_SIGNATURE' };
  if (rootIdentity(p.content.caChainPem) !== rootIdentity(current.caChainPem)) return { decision: 'REJECTED_ROOT' };
  if (!checkCosignSectionChange(current, p.content)) return { decision: 'REJECTED_COSIGN_SECTION' };
  return { decision: 'OK', content: p.content };
}

/** The first bundle: authenticated through the pinned root and the CA chain (see header). */
export function verifyFirstTrustBundle(bundle: SignedTrustBundle, pinnedRootFingerprint: string): { decision: TrustBundleDecision; content?: TrustBundleContent } {
  const p = parse(bundle);
  if (!p) return { decision: 'REJECTED_SCHEMA' };
  const { content } = p;
  let chain: X509Certificate[];
  try { chain = content.caChainPem.map((pem) => new X509Certificate(pem)); } catch { return { decision: 'REJECTED_CHAIN' }; }
  const root = chain[chain.length - 1];
  if (sha256Hex(root.raw) !== pinnedRootFingerprint.toLowerCase().replace(/[^0-9a-f]/g, '')) return { decision: 'REJECTED_ROOT' };
  if (!root.verify(root.publicKey)) return { decision: 'REJECTED_CHAIN' };
  for (let i = 0; i < chain.length - 1; i++) if (!chain[i].verify(chain[i + 1].publicKey)) return { decision: 'REJECTED_CHAIN' };
  const k = content.bundleKeys.find((x) => x.kid === bundle.kid);
  if (!k || k.revoked) return { decision: 'REJECTED_KID' };
  if (!k.attestation) return { decision: 'REJECTED_ATTESTATION' };
  let attested = false;
  try { attested = cryptoVerify('sha256', attestationBytes(k.kid, k.publicKey), chain[0].publicKey, Buffer.from(k.attestation, 'base64url')); } catch { /* malformed */ }
  if (!attested) return { decision: 'REJECTED_ATTESTATION' };
  if (!checkSignature(content, bundle, importPublicKey(k.publicKey))) return { decision: 'REJECTED_SIGNATURE' };
  return { decision: 'OK', content };
}


/**
 * Turns a raw IEEE-P1363 ECDSA signature (r || s, what WebCrypto and most KMS APIs return) into the DER
 * form `verifyFirstTrustBundle` checks, base64url. For a CA key held as a non-extractable CryptoKey.
 */
export function attestationFromP1363(raw: Buffer, partLength = 32): string {
  if (raw.length !== partLength * 2) throw new RangeError('unexpected ECDSA signature length');
  const der = (n: Buffer) => {
    let i = 0;
    while (i < n.length - 1 && n[i] === 0) i++;
    let v = n.subarray(i);
    if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const body = Buffer.concat([der(raw.subarray(0, partLength)), der(raw.subarray(partLength))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]).toString('base64url');
}
