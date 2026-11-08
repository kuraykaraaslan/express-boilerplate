/**
 * Build identity of the running image (docs/phases/02-fleet 10-roadmap Phase 4).
 *
 * `RELEASE_VERSION`, `IMAGE_DIGEST` and `GIT_SHA` are baked in by the Dockerfile (ARG -> ENV). They replace
 * `APPLICATION_VERSION`. An empty value is the same as unset: a Docker `ARG` without a value arrives as `""`.
 * Pure and dependency-free so health routes, the process host and Sentry share one reading.
 */
export interface BuildInfoInput {
  RELEASE_VERSION?: string;
  IMAGE_DIGEST?: string;
  GIT_SHA?: string;
}

export interface BuildInfo {
  /** The release this image was built for (`dev` outside a release build). */
  version: string;
  /** `sha256:...` of the pushed image, or null while unknown. */
  imageDigest: string | null;
  /** Commit the image was built from, or null. */
  gitSha: string | null;
  /** The Sentry `release`: the version, or the short commit when the version is only `dev`. */
  release: string;
}

const DEFAULT_VERSION = 'dev';
const SHORT_SHA_LENGTH = 12;

function clean(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function resolveBuildInfo(input: BuildInfoInput): BuildInfo {
  const version = clean(input.RELEASE_VERSION) ?? DEFAULT_VERSION;
  const gitSha = clean(input.GIT_SHA);
  const imageDigest = clean(input.IMAGE_DIGEST);
  const release = version === DEFAULT_VERSION && gitSha ? gitSha.slice(0, SHORT_SHA_LENGTH) : version;
  return { version, imageDigest, gitSha, release };
}
