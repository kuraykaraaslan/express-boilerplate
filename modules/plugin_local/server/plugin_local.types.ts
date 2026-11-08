import type { SandboxGrant, SandboxLimits } from '@kuraykaraaslan-labs/plugin_runtime/server/manifest/plugin-manifest';
import type { LocalPluginStatus } from './entities/local_plugin.entity';

export interface TrustedKey {
  kid: string;
  /** Ed25519 public key, SPKI DER base64. */
  publicKey: string;
}

export interface TrustPolicy {
  trustedKeys: TrustedKey[];
  requireSigned: boolean;
  /** Ceiling of every approved grant's limits. */
  maxLimits: SandboxLimits;
}

/** An approved grant as stored in `LocalPluginVersion.sandboxJson` (limits already capped). */
export interface ApprovedGrant extends Omit<SandboxGrant, 'limits'> {
  limits: SandboxLimits;
}

export interface UploadInput {
  /** Defaults to the manifest `id`. `@scope/name` or `name`. */
  scopedName?: string;
  manifestJson: string;
  /** The bundle (plugin.js) as base64. */
  bundleBase64: string;
  /** The SHA-256 the operator built; a mismatch refuses the upload. */
  bundleSha256?: string;
  /** Detached Ed25519 signature (base64) over the digest bytes. */
  signature?: string;
  /** Which trusted key signed it. */
  signerKid?: string;
}

export interface LocalVersionView {
  versionId: string;
  version: string;
  createdAt: string;
  bundleSha256: string;
  signatureVerified: boolean;
  signerKid: string | null;
  approved: boolean;
  approvedAt: string | null;
  yanked: boolean;
  yankedReason: string | null;
  /** What the manifest asks for (strictly validated at upload). */
  requested: SandboxGrant;
  /** What the operator approved (null until approved). */
  grant: ApprovedGrant | null;
  /** Extension points the manifest contributes to. */
  points: string[];
  scanStatus: string | null;
}

export interface LocalPluginView {
  pluginId: string;
  scopedName: string;
  runtimePluginId: string;
  name: string;
  status: LocalPluginStatus;
  currentVersionId: string | null;
  createdAt: string;
  versions: LocalVersionView[];
}

export interface LocalInstallView {
  tenantId: string;
  versionId: string;
  version: string | null;
  active: boolean;
  installedAt: string | null;
  /** Whether the plugin_local module is enabled for the tenant: without it the plugin does not run there. */
  moduleEnabled: boolean;
}

/** A LocalPlugin / LocalPluginVersion id (uuid). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
