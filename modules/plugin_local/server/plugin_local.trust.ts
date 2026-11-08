// The operator's trust policy for local plugins (ROOT settings): which Ed25519 keys may sign a bundle, whether a
// signature is required, and the ceiling every approved sandbox grant is capped at. Signatures verify ONLY against
// keys registered here, out of band, never against a key that arrives with the upload.

import { getDataSource } from '@kuraykaraaslan-labs/db';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { loadRuntimeConfig } from '@kuraykaraaslan-labs/plugin_runtime/server/rpc/protocol';
import { evictPluginVersions } from '@kuraykaraaslan-labs/plugin_runtime/server/rpc/host-client';
import { validateSigningPublicKey, verifyBundleSignature } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-integrity';
import { builtinPlugin, BUILTIN_BUNDLE_PREFIX, isBuiltinBundleKey } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/builtin-bundles';
import { LIMIT_KEYS, type SandboxLimits } from '@kuraykaraaslan-labs/plugin_runtime/server/manifest/plugin-manifest';
import { PLUGIN_LOCAL_SETTING_KEYS as KEYS } from './plugin_local.setting.keys';
import { LocalPluginVersion } from './entities/local_plugin_version.entity';
import type { TrustedKey, TrustPolicy } from './plugin_local.types';

const KID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const MAX_KEYS = 50;

function parseKeys(raw: string | null | undefined): TrustedKey[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((k) => {
      const kid = (k as { kid?: unknown })?.kid;
      const publicKey = (k as { publicKey?: unknown })?.publicKey;
      return typeof kid === 'string' && typeof publicKey === 'string' ? [{ kid, publicKey }] : [];
    });
  } catch {
    return []; // unreadable → no trusted key; signatures then fail closed
  }
}

/** The platform maximum: the runtime defaults, lowered (never raised) by the ROOT setting. */
export function maxLimitsFrom(raw: string | null | undefined): SandboxLimits {
  const runtime = loadRuntimeConfig().defaultLimits;
  const out = { ...runtime };
  if (!raw) return out;
  try {
    const lower = JSON.parse(raw) as Record<string, unknown>;
    for (const k of LIMIT_KEYS) {
      const v = lower?.[k];
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[k] = Math.min(v, runtime[k]);
    }
  } catch { /* unreadable → runtime defaults */ }
  return out;
}

export async function readTrustPolicy(): Promise<TrustPolicy> {
  const rec = await SettingService.getByKeys(ROOT_TENANT_ID, [KEYS.TRUSTED_KEYS, KEYS.REQUIRE_SIGNED, KEYS.MAX_LIMITS]);
  return {
    trustedKeys: parseKeys(rec[KEYS.TRUSTED_KEYS]),
    requireSigned: rec[KEYS.REQUIRE_SIGNED] === 'true',
    maxLimits: maxLimitsFrom(rec[KEYS.MAX_LIMITS]),
  };
}

/**
 * Verify a detached signature over the bundle digest against the operator's registered key `kid`.
 * Throws (400) on an unknown kid or a signature that does not verify; returns the kid that verified.
 */
export function verifyAgainstTrusted(policy: TrustPolicy, sha256: string, signature: string, kid: string | undefined): string {
  if (!kid) throw new AppError('A signed bundle must name the key it was signed with (signerKid).', 400, ErrorCode.VALIDATION_ERROR);
  const key = policy.trustedKeys.find((k) => k.kid === kid);
  if (!key) throw new AppError(`The signing key '${kid}' is not registered as trusted on this platform.`, 400, ErrorCode.VALIDATION_ERROR);
  if (!verifyBundleSignature(key.publicKey, sha256, signature)) {
    throw new AppError(`The bundle signature does not verify against the trusted key '${kid}'.`, 400, ErrorCode.VALIDATION_ERROR);
  }
  return kid;
}

/**
 * Does a stored, verified signature still verify against a key that is trusted NOW (keys can be removed)? A built-in bundle
 * (`builtin:` key, builtin-bundles.ts) is the platform's own code, shipped and signed with the image: it is trusted while its
 * recorded checksum is the one of the built-in this platform ships, and never otherwise.
 */
export function stillTrusted(policy: TrustPolicy, v: { signatureVerified: boolean; signature: string | null; signerKid: string | null; bundleSha256: string; bundleKey?: string | null }): boolean {
  if (isBuiltinBundleKey(v.bundleKey)) {
    return builtinPlugin(v.bundleKey!.slice(BUILTIN_BUNDLE_PREFIX.length))?.bundleSha256 === v.bundleSha256;
  }
  if (!v.signatureVerified || !v.signature || !v.signerKid) return false;
  const key = policy.trustedKeys.find((k) => k.kid === v.signerKid);
  return !!key && verifyBundleSignature(key.publicKey, v.bundleSha256, v.signature);
}

/**
 * Replace the trust policy (ROOT). Every key is validated as Ed25519 SPKI; kids must be unique. Audited. A change of
 * the limit ceiling evicts every approved local version's warm isolates: the plugin host fixes an isolate's memory and
 * timeout when it first loads a version, so only a fresh load runs under the new ceiling.
 */
export async function writeTrustPolicy(
  input: { trustedKeys?: TrustedKey[]; requireSigned?: boolean; maxLimits?: Partial<SandboxLimits> },
  actorId?: string,
): Promise<TrustPolicy> {
  const patch: Record<string, string> = {};
  if (input.trustedKeys) {
    if (input.trustedKeys.length > MAX_KEYS) throw new AppError(`At most ${MAX_KEYS} trusted keys.`, 400, ErrorCode.VALIDATION_ERROR);
    const seen = new Set<string>();
    const keys = input.trustedKeys.map((k) => {
      if (!KID_RE.test(k.kid)) throw new AppError(`Key id '${k.kid}' is not valid (letters, digits, _ . : -).`, 400, ErrorCode.VALIDATION_ERROR);
      if (seen.has(k.kid)) throw new AppError(`Key id '${k.kid}' is listed twice.`, 400, ErrorCode.VALIDATION_ERROR);
      seen.add(k.kid);
      let publicKey: string;
      try { publicKey = validateSigningPublicKey(k.publicKey); } catch (e) {
        throw new AppError(`${k.kid}: ${(e as Error).message}`, 400, ErrorCode.VALIDATION_ERROR);
      }
      return { kid: k.kid, publicKey };
    });
    patch[KEYS.TRUSTED_KEYS] = JSON.stringify(keys);
  }
  if (input.requireSigned !== undefined) patch[KEYS.REQUIRE_SIGNED] = String(input.requireSigned);
  if (input.maxLimits) {
    const clean: Partial<SandboxLimits> = {};
    for (const k of LIMIT_KEYS) {
      const v = input.maxLimits[k];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v <= 0) throw new AppError(`maxLimits.${k} must be a positive integer.`, 400, ErrorCode.VALIDATION_ERROR);
      clean[k] = v;
    }
    patch[KEYS.MAX_LIMITS] = JSON.stringify(clean);
  }
  if (Object.keys(patch).length) {
    const before = patch[KEYS.MAX_LIMITS] !== undefined ? (await readTrustPolicy()).maxLimits : null;
    await SettingService.updateMany(ROOT_TENANT_ID, patch, actorId ? { actorId } : undefined);
    await SettingService.clearCache(ROOT_TENANT_ID);
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID,
      actorId: actorId ?? null,
      action: 'plugin_local.trust.update',
      resourceType: 'plugin_local_trust',
      resourceId: 'platform',
      metadata: {
        ...(input.trustedKeys && { kids: input.trustedKeys.map((k) => k.kid) }),
        ...(input.requireSigned !== undefined && { requireSigned: input.requireSigned }),
        ...(input.maxLimits && { maxLimits: patch[KEYS.MAX_LIMITS] }),
      },
    });
    if (before) {
      const after = (await readTrustPolicy()).maxLimits;
      if (LIMIT_KEYS.some((k) => before[k] !== after[k])) {
        const versions = await (await getDataSource()).getRepository(LocalPluginVersion).find();
        const approved = versions.filter((v) => v.sandboxJson).map((v) => v.versionId);
        if (approved.length) await evictPluginVersions(approved).catch(() => null);
      }
    }
  }
  return readTrustPolicy();
}
