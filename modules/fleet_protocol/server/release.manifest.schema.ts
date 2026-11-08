import { z } from 'zod';
import { ReleaseMigrationSchema, checkMigrationPlan } from './contract.schema';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const semver = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/);

/** Release manifest (02/02 fleet_releases.manifest, 03 section 8.5). Images are pinned by digest only. */
export const ReleaseManifestSchema = z
  .object({
    images: z
      .array(
        z.object({
          target: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          ref: z.string().min(1).max(512),
          digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        }).strict(),
      )
      .min(1)
      .max(32),
    composeTemplateHash: sha256,
    migrations: z.array(ReleaseMigrationSchema).max(500),
    schemaVersion: z.string().min(1).max(128),
    envSchemaVersion: z.string().min(1).max(128),
    minAgentVersion: semver,
    maxAgentVersion: semver.optional(),
    protocolVersions: z.array(z.number().int().positive()).min(1).max(16),
    compatibleWithPrevious: z.boolean(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const bad = checkMigrationPlan(m.migrations, m);
    if (bad) ctx.addIssue({ code: 'custom', path: ['migrations'], message: bad });
  });
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

/**
 * Doubly-signed release (07 section 5.1, 04 section 8.4, T12): a manifest is deployable only with BOTH halves.
 *
 * 1. `provenance`: the CI attestation. An Ed25519 signature by a CI key over a statement naming the source (repo, ref, workflow),
 *    the manifest hash and the exact `target -> digest` pairs that were built. CI holding this key alone is not enough (see 2).
 * 2. `approval`: a RELEASE_MANAGER signature over (version, channel, manifestHash, provenanceHash), so the human signs the
 *    manifest AND the very attestation they reviewed; swapping the CI half afterwards breaks the signature.
 *
 * Both are domain-separated documents (`document.ts`), carry an `exp` and a bounded lifetime, and are checked by `verifySignedRelease`.
 */
export const MAX_RELEASE_SIGNATURE_TTL_SECONDS = 90 * 24 * 3600;

const sig = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const kid = z.string().min(1).max(128);
const channel = z.string().regex(/^[A-Z_]{1,32}$/);
const ts = z.number().int().positive();

function boundedLifetime(from: 'builtAt' | 'signedAt') {
  return (s: { exp: number } & Record<string, unknown>, ctx: z.core.$RefinementCtx) => {
    const start = s[from] as number;
    if (s.exp <= start || s.exp - start > MAX_RELEASE_SIGNATURE_TTL_SECONDS) {
      ctx.addIssue({ code: 'custom', path: ['exp'], message: `exp must be after ${from} and within ${MAX_RELEASE_SIGNATURE_TTL_SECONDS}s` });
    }
  };
}

export const ProvenanceStatementSchema = z
  .object({
    v: z.literal(1),
    manifestHash: sha256,
    repo: z.string().min(1).max(256),
    ref: z.string().min(1).max(256),
    workflow: z.string().min(1).max(256),
    images: z
      .array(z.object({ target: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict())
      .min(1)
      .max(32),
    builtAt: ts,
    exp: ts,
  })
  .strict()
  .superRefine(boundedLifetime('builtAt'));
export type ProvenanceStatement = z.infer<typeof ProvenanceStatementSchema>;

export const ProvenanceAttestationSchema = z.object({ kid, statement: ProvenanceStatementSchema, sig }).strict();
export type ProvenanceAttestation = z.infer<typeof ProvenanceAttestationSchema>;

export const ReleaseApprovalStatementSchema = z
  .object({
    v: z.literal(1),
    version: semver,
    channel,
    manifestHash: sha256,
    provenanceHash: sha256,
    signedAt: ts,
    exp: ts,
  })
  .strict()
  .superRefine(boundedLifetime('signedAt'));
export type ReleaseApprovalStatement = z.infer<typeof ReleaseApprovalStatementSchema>;

export const ReleaseApprovalSchema = z.object({ kid, statement: ReleaseApprovalStatementSchema, sig }).strict();
export type ReleaseApproval = z.infer<typeof ReleaseApprovalSchema>;

export const DoublySignedReleaseSchema = z
  .object({ manifest: ReleaseManifestSchema, provenance: ProvenanceAttestationSchema, approval: ReleaseApprovalSchema })
  .strict();
export type DoublySignedRelease = z.infer<typeof DoublySignedReleaseSchema>;
