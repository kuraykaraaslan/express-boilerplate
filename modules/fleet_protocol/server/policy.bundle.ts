import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalize } from './canonical';
import { signDocument, verifyDocument } from './document';
import { importPublicKey } from './sign';
import { PolicySchema, type Policy } from './policy.schema';

/**
 * A signed, per-node policy bundle (docs/phases/02-fleet/04 §4.3): the CENTRAL effective policy for one node (global, region and node
 * documents already merged tighten-only), signed with a trust-bundle key under its own document domain, so it can never be replayed
 * as a trust bundle, a license or an envelope. The node merges it with its own regional-key-signed override and can only get
 * stricter. `version` is monotonic per node; the node refuses an older or equal one and a bundle addressed to another node.
 */
export const POLICY_BUNDLE_DOMAIN = 'fleet.policy-bundle';

export const PolicyBundleContentSchema = z.object({
  v: z.literal(1),
  version: z.number().int().positive(),
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  issuedAt: z.string().datetime(),
  policy: PolicySchema,
  /** sha256 over the canonical policy: what the heartbeat reports as `effectivePolicyHash` for drift detection. */
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PolicyBundleContent = z.infer<typeof PolicyBundleContentSchema>;
export interface SignedPolicyBundle { version: number; content: string; sig: string; kid: string }

export const policyHash = (policy: Policy): string => createHash('sha256').update(canonicalize(policy)).digest('hex');

export function signPolicyBundle(c: Omit<PolicyBundleContent, 'policyHash' | 'v'>, kid: string, privateKey: KeyObject): SignedPolicyBundle {
  const content = PolicyBundleContentSchema.parse({ ...c, v: 1, policyHash: policyHash(c.policy as Policy) });
  return { version: content.version, content: canonicalize(content), sig: signDocument(POLICY_BUNDLE_DOMAIN, content, privateKey), kid };
}

export type PolicyBundleDecision = 'OK' | 'REJECTED_SCHEMA' | 'REJECTED_KID' | 'REJECTED_SIGNATURE' | 'REJECTED_NODE' | 'REJECTED_VERSION' | 'REJECTED_HASH';

/** `bundleKeys` come from the installed, verified trust bundle (`{kid, publicKey, revoked?}`); `currentVersion` is what the node already runs (0 = none). */
export function verifyPolicyBundle(
  bundle: SignedPolicyBundle, ctx: { bundleKeys: readonly { kid: string; publicKey: string; revoked?: boolean }[]; nodeId: string; currentVersion: number },
): { decision: PolicyBundleDecision; content?: PolicyBundleContent } {
  let content: PolicyBundleContent;
  try {
    content = PolicyBundleContentSchema.parse(JSON.parse(bundle.content));
    if (canonicalize(content) !== bundle.content || content.version !== bundle.version) return { decision: 'REJECTED_SCHEMA' };
  } catch { return { decision: 'REJECTED_SCHEMA' }; }
  const key = ctx.bundleKeys.find((k) => k.kid === bundle.kid);
  if (!key || key.revoked) return { decision: 'REJECTED_KID' };
  if (!verifyDocument(POLICY_BUNDLE_DOMAIN, content, bundle.sig, importPublicKey(key.publicKey))) return { decision: 'REJECTED_SIGNATURE' };
  if (content.nodeId !== ctx.nodeId) return { decision: 'REJECTED_NODE' };
  if (content.version <= ctx.currentVersion) return { decision: 'REJECTED_VERSION' };
  if (policyHash(content.policy as Policy) !== content.policyHash) return { decision: 'REJECTED_HASH' };
  return { decision: 'OK', content };
}

/**
 * The regional operator's local override (04 §4.3): a policy document signed by the REGIONAL operator key the node pinned at enrollment,
 * under its own document domain. The node merges it with the central bundle tighten-only, so it can raise a floor or forbid a kind and can
 * never loosen what the control plane set.
 */
export const POLICY_OVERRIDE_DOMAIN = 'fleet.policy-override';
export const PolicyOverrideSchema = z.object({ v: z.literal(1), nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), issuedAt: z.string().datetime(), policy: PolicySchema }).strict();
export type PolicyOverride = z.infer<typeof PolicyOverrideSchema>;

export function signPolicyOverride(o: Omit<PolicyOverride, 'v'>, privateKey: KeyObject): { content: string; sig: string } {
  const content = PolicyOverrideSchema.parse({ ...o, v: 1 });
  return { content: canonicalize(content), sig: signDocument(POLICY_OVERRIDE_DOMAIN, content, privateKey) };
}

export function verifyPolicyOverride(doc: { content: string; sig: string }, publicKey: KeyObject, nodeId: string): { ok: true; policy: Policy } | { ok: false } {
  try {
    const content = PolicyOverrideSchema.parse(JSON.parse(doc.content));
    if (canonicalize(content) !== doc.content || content.nodeId !== nodeId) return { ok: false };
    return verifyDocument(POLICY_OVERRIDE_DOMAIN, content, doc.sig, publicKey) ? { ok: true, policy: content.policy as Policy } : { ok: false };
  } catch { return { ok: false }; }
}
