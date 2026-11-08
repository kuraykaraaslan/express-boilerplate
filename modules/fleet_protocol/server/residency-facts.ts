import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalize } from './canonical';
import { signDocument, verifyDocument } from './document';
import { importPublicKey } from './sign';

/**
 * The residency section of the policy lane (decision F3, O-19 option c; 08 section 2 "Processor / sub-processor boundaries"): the facts about a
 * node's region that a tenant admin may see on the node's "Residency facts" page, signed by the control plane with a trust-bundle key under its
 * own document domain, so it can never pass as a policy bundle, a trust bundle or an envelope. It travels on the policy lane next to the per-node
 * policy bundle (`GET /api/fleet/agent/policy?facts=<hash>`), versioned on its own: a sub-processor change must reach the node without
 * minting a policy version, and a policy change must not depend on the register.
 *
 * Everything in it is class G: the region's residency class, bloc, jurisdiction, legal frameworks and framework preset, and the ACTIVE
 * sub-processors of the region and of the control plane as closed values plus the company name. It carries no free text of the register
 * (`purpose`, `dpaRef`, `notes`), no operator id, no tenant field.
 *
 * Freshness: `issuedAt` (whole seconds) is monotonic per node, so the node refuses a section older than or as old as the one it holds (a replayed
 * older register), and `factsHash` is what the heartbeat announces and the node compares, so an unchanged register is never fetched again.
 */
export const RESIDENCY_FACTS_DOMAIN = 'fleet.residency-facts';

/** Closed vocabularies, mirrored from `fleet_compliance.subprocessors.rules` (the leaf protocol imports no module; a fleet test pins the equality). */
export const RESIDENCY_SUBPROCESSOR_SERVICES = ['HOSTING', 'DATABASE', 'OBJECT_STORAGE', 'BACKUP', 'KMS', 'EMAIL', 'SMS', 'PUSH', 'PAYMENTS', 'MONITORING', 'CDN_DNS', 'SUPPORT', 'OTHER'] as const;
export const RESIDENCY_DATA_CATEGORIES = ['TENANT_CONTENT', 'BACKUPS', 'LOGS', 'CONTACT_DATA', 'PAYMENT_DATA', 'KEYS', 'OPERATOR_DATA', 'IDENTITY_LOGIN', 'TENANT_DIRECTORY', 'TELEMETRY_G'] as const;
export const RESIDENCY_FACT_CLASSES = ['STRICT', 'BLOC'] as const;
export const RESIDENCY_SUBPROCESSOR_SCOPES = ['REGION', 'CONTROL_PLANE'] as const;
export const MAX_RESIDENCY_SUBPROCESSORS = 64;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const unique = <T,>(a: readonly T[]): boolean => new Set(a).size === a.length;

/** A company name is the one string that is not a closed value: one trimmed line without control characters (the register's own rule), shown as text only. */
const CompanyName = z.string().min(1).max(160).regex(/^[^\p{Cc}]*$/u).refine((s) => s.trim() === s, 'untrimmed');

export const ResidencySubprocessorSchema = z.object({
  scope: z.enum(RESIDENCY_SUBPROCESSOR_SCOPES),
  name: CompanyName,
  service: z.enum(RESIDENCY_SUBPROCESSOR_SERVICES),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  dataCategories: z.array(z.enum(RESIDENCY_DATA_CATEGORIES)).min(1).max(RESIDENCY_DATA_CATEGORIES.length).refine(unique, 'duplicate data category'),
  transferMechanism: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
}).strict();
export type ResidencySubprocessor = z.infer<typeof ResidencySubprocessorSchema>;

export const ResidencyRegionSchema = z.object({
  regionId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  blocId: z.string().regex(/^[a-z][a-z0-9-]{0,15}$/),
  jurisdictionCode: z.string().regex(/^[A-Z]{2}$/),
  residencyClass: z.enum(RESIDENCY_FACT_CLASSES),
  legalFrameworks: z.array(z.string().regex(/^[A-Z][A-Z0-9-]{1,15}$/)).max(8).refine(unique, 'duplicate legal framework'),
  frameworkPreset: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
}).strict();
export type ResidencyRegion = z.infer<typeof ResidencyRegionSchema>;

/**
 * What the facts are, without the envelope fields: the part `factsHash` covers.
 *
 * `region: null` is the signed withdrawal: the control plane has no facts for the node any more (its region was cleared, the registry no longer
 * knows it, or the region's row no longer passes this schema). It carries no sub-processor, and it replaces the section the node holds like any
 * newer section does, so the page says "not reported" instead of showing the old region's facts as signed by the fleet.
 *
 * `subprocessorsTotal` is how many ACTIVE entries the register holds for the region and the control plane. The list stops at
 * MAX_RESIDENCY_SUBPROCESSORS (and leaves out an entry the register would no longer accept), so a total above the list length tells the page
 * the list is not complete, and the signed bytes never pass an incomplete list off as the whole one.
 */
const ResidencyFactsBodyShape = {
  region: ResidencyRegionSchema.nullable(),
  subprocessors: z.array(ResidencySubprocessorSchema).max(MAX_RESIDENCY_SUBPROCESSORS),
  subprocessorsTotal: z.number().int().min(0).max(1_000_000),
};
const bodyRules = (b: { region: ResidencyRegion | null; subprocessors: readonly unknown[]; subprocessorsTotal: number }, ctx: z.RefinementCtx): void => {
  if (b.subprocessorsTotal < b.subprocessors.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'total below the list length', path: ['subprocessorsTotal'] });
  if (b.region === null && (b.subprocessors.length > 0 || b.subprocessorsTotal > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a withdrawal lists nothing', path: ['subprocessors'] });
};
export const ResidencyFactsBodySchema = z.object(ResidencyFactsBodyShape).strict().superRefine(bodyRules);
export type ResidencyFactsBody = z.infer<typeof ResidencyFactsBodySchema>;

export const ResidencyFactsContentSchema = z.object({
  ...ResidencyFactsBodyShape,
  v: z.literal(1),
  nodeId: z.string().regex(ID),
  issuedAt: z.string().datetime().refine((s) => s.endsWith('.000Z'), 'whole seconds'),
  factsHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine(bodyRules);
export type ResidencyFactsContent = z.infer<typeof ResidencyFactsContentSchema>;

/** The body of a section (what the hash covers), taken from a content or any wider object. */
export const residencyFactsBodyOf = (c: ResidencyFactsBody): ResidencyFactsBody => ({ region: c.region, subprocessors: c.subprocessors, subprocessorsTotal: c.subprocessorsTotal });
export interface SignedResidencyFacts { content: string; sig: string; kid: string }

/** The wire shape of a signed section (bounded before anything is parsed). */
export const SignedResidencyFactsSchema = z.object({ content: z.string().min(2).max(65536), sig: z.string().max(128), kid: z.string().max(64) }).strict();

/** sha256 over the canonical body: order of sub-processors matters (the control plane emits them sorted), envelope fields do not. */
export const residencyFactsHash = (body: ResidencyFactsBody): string => createHash('sha256').update(canonicalize(body)).digest('hex');

/** The sub-processors in the one order the control plane emits: scope, service, name, country. */
export function sortResidencySubprocessors(list: readonly ResidencySubprocessor[]): ResidencySubprocessor[] {
  const k = (s: ResidencySubprocessor) => [s.scope, s.service, s.name, s.countryCode, s.transferMechanism ?? '', s.dataCategories.join(',')];
  return [...list].sort((a, b) => {
    const ka = k(a); const kb = k(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}

/** `subprocessorsTotal` defaults to the list length (a complete list). */
export function signResidencyFacts(
  c: { nodeId: string; issuedAt: string } & Omit<ResidencyFactsBody, 'subprocessorsTotal'> & { subprocessorsTotal?: number }, kid: string, privateKey: KeyObject,
): SignedResidencyFacts {
  const body = ResidencyFactsBodySchema.parse({ region: c.region, subprocessors: c.subprocessors, subprocessorsTotal: c.subprocessorsTotal ?? c.subprocessors.length });
  const content = ResidencyFactsContentSchema.parse({ ...body, v: 1, nodeId: c.nodeId, issuedAt: c.issuedAt, factsHash: residencyFactsHash(body) });
  return { content: canonicalize(content), sig: signDocument(RESIDENCY_FACTS_DOMAIN, content, privateKey), kid };
}

export type ResidencyFactsDecision = 'OK' | 'REJECTED_SCHEMA' | 'REJECTED_KID' | 'REJECTED_SIGNATURE' | 'REJECTED_NODE' | 'REJECTED_STALE' | 'REJECTED_HASH';

/**
 * Verifies a section for THIS node against the bundle keys of the installed trust bundle. `notBefore` is the `issuedAt` of the section the node
 * already holds (absent = none): an equal or older one is refused, so a captured older register cannot be replayed over a newer one.
 */
export function verifyResidencyFacts(
  signed: unknown, ctx: { bundleKeys: readonly { kid: string; publicKey: string; revoked?: boolean }[]; nodeId: string; notBefore?: string | null },
): { decision: ResidencyFactsDecision; content?: ResidencyFactsContent } {
  let content: ResidencyFactsContent; let s: SignedResidencyFacts;
  try {
    s = SignedResidencyFactsSchema.parse(signed);
    content = ResidencyFactsContentSchema.parse(JSON.parse(s.content));
    if (canonicalize(content) !== s.content) return { decision: 'REJECTED_SCHEMA' };
  } catch { return { decision: 'REJECTED_SCHEMA' }; }
  const key = ctx.bundleKeys.find((k) => k.kid === s.kid);
  if (!key || key.revoked) return { decision: 'REJECTED_KID' };
  let ok = false;
  try { ok = verifyDocument(RESIDENCY_FACTS_DOMAIN, content, s.sig, importPublicKey(key.publicKey)); } catch { ok = false; }
  if (!ok) return { decision: 'REJECTED_SIGNATURE' };
  if (content.nodeId !== ctx.nodeId) return { decision: 'REJECTED_NODE' };
  if (ctx.notBefore && Date.parse(content.issuedAt) <= Date.parse(ctx.notBefore)) return { decision: 'REJECTED_STALE' };
  if (residencyFactsHash(residencyFactsBodyOf(content)) !== content.factsHash) return { decision: 'REJECTED_HASH' };
  return { decision: 'OK', content };
}
