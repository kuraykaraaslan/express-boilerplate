// saml: HOST-SIDE, vetted SAML 2.0 (XML-DSig). The signing (AuthnRequest) and the
// signature/assertion verification must NOT run in the untrusted isolate, and the SP
// private/decryption keys must never enter it. The isolate passes only NON-SECRET
// config (idp cert, entity ids, endpoints); the broker reads the SP keys from the
// plugin's encrypted secrets host-side, builds a node-saml client, and returns a URL
// (generateAuthUrl) or the neutral validated assertion (validateResponse).
import { SAML } from '@node-saml/node-saml';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption';
import type { Json } from '../../../sdk/types';
import { SECRET_PREFIX, configTenantOf, type BrokerCtx } from '../broker.context';

type SamlVerifyConfig = {
  callbackUrl?: string; idpSsoUrl?: string; spEntityId?: string; idpCertificate?: string;
  signatureAlgorithm?: string; nameIdFormat?: string; wantAssertionsSigned?: boolean;
  acceptedClockSkewMs?: number; signRequests?: boolean; authnContextClassRefs?: string[];
  racComparison?: 'exact' | 'minimum' | 'maximum' | 'better'; disableRequestedAuthnContext?: boolean;
};

/**
 * MS-41 (2026-10-27): the signature posture a plugin's SAML config may ask for. node-saml names the algorithms `sha1` /
 * `sha256` / `sha512`; only sha256 and sha512 are allowed, and assertions must be signed (`wantAssertionsSigned: false`
 * turns the assertion signature check off). The config arrives from the isolate on every call, so this is both the write
 * and the read check: a weak config is refused before any client is built, with the change the plugin must make. Same
 * rule as auth_saml's engine (saml.engine.ts samlSignaturePolicyProblem); plugin_runtime does not import auth_saml.
 */
const ALLOWED_SIGNATURE_ALGORITHMS: readonly string[] = ['sha256', 'sha512'];

export function samlConfigPolicyProblem(c: SamlVerifyConfig): string | null {
  const problems: string[] = [];
  if (c.signatureAlgorithm !== undefined && c.signatureAlgorithm !== null && c.signatureAlgorithm !== ''
    && !ALLOWED_SIGNATURE_ALGORITHMS.includes(String(c.signatureAlgorithm))) {
    problems.push('signatureAlgorithm must be sha256 or sha512');
  }
  if (c.wantAssertionsSigned !== undefined && c.wantAssertionsSigned !== true) {
    problems.push('wantAssertionsSigned must be true (assertions must be signed)');
  }
  return problems.length ? `saml: weak signature config refused: ${problems.join('; ')}` : null;
}

/** Read an SP key from the plugin's encrypted secret store (host-side only). */
async function readSecret(ctx: BrokerCtx, name: string): Promise<string | undefined> {
  const raw = await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + name);
  if (raw == null) return undefined;
  const dec = decryptFieldOpt(raw);
  return typeof dec === 'string' && dec.length ? dec : undefined;
}

/** Build a node-saml client from non-secret config + host-side SP keys. */
async function buildClient(ctx: BrokerCtx, c: SamlVerifyConfig): Promise<SAML> {
  const problem = samlConfigPolicyProblem(c);
  if (problem) throw new Error(problem);
  if (!c.idpCertificate) throw new Error('saml: idpCertificate required');
  const spPrivateKey = await readSecret(ctx, 'spPrivateKey');
  const spDecryptionKey = (await readSecret(ctx, 'spDecryptionKey')) ?? spPrivateKey;
  const signing = (c.signRequests ?? true) && Boolean(spPrivateKey);
  return new SAML({
    callbackUrl: c.callbackUrl,
    entryPoint: c.idpSsoUrl,
    issuer: c.spEntityId,
    idpCert: c.idpCertificate,
    privateKey: signing ? spPrivateKey : undefined,
    decryptionPvk: spDecryptionKey,
    signatureAlgorithm: (c.signatureAlgorithm as 'sha256' | 'sha512') || 'sha256',
    identifierFormat: c.nameIdFormat ?? undefined,
    wantAssertionsSigned: true,
    acceptedClockSkewMs: typeof c.acceptedClockSkewMs === 'number' ? c.acceptedClockSkewMs : 5000,
    ...(c.authnContextClassRefs?.length
      ? { authnContext: c.authnContextClassRefs, racComparison: c.racComparison ?? 'minimum' }
      : c.disableRequestedAuthnContext ? { disableRequestedAuthnContext: true } : {}),
  } as ConstructorParameters<typeof SAML>[0]);
}

/**
 * AuthnStatement@SessionNotOnOrAfter of the VALIDATED assertion (node-saml parses the verified assertion XML and
 * exposes it as profile.getAssertion(); it does not lift this attribute onto the profile itself), as epoch ms — the
 * shape the national-id consumers take (auth_national_id.types sessionNotOnOrAfter). Null when absent or not an
 * xs:dateTime, never a guess.
 */
function sessionNotOnOrAfterOf(profile: Record<string, unknown>): number | null {
  try {
    const getAssertion = profile.getAssertion;
    if (typeof getAssertion !== 'function') return null;
    const doc = getAssertion.call(profile) as { Assertion?: { AuthnStatement?: Array<{ $?: Record<string, unknown> }> } } | null;
    const raw = doc?.Assertion?.AuthnStatement?.[0]?.$?.SessionNotOnOrAfter;
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw.trim())) return null;
    const ms = Date.parse(raw.trim());
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export const saml = {
  /** Build (and sign, if an SP key is set) the SP-initiated SSO redirect URL. */
  async generateAuthUrl(ctx: BrokerCtx, relayState: string, config: SamlVerifyConfig): Promise<Json> {
    const client = await buildClient(ctx, config ?? {});
    return (await client.getAuthorizeUrlAsync(String(relayState ?? ''), '', {})) as Json;
  },

  /** Validate a signed SAML POST response → neutral assertion (attributes + nameId). */
  async validateResponse(ctx: BrokerCtx, body: Record<string, string>, config: SamlVerifyConfig): Promise<Json> {
    const client = await buildClient(ctx, config ?? {});
    let profile: Record<string, unknown> | null;
    try {
      ({ profile } = (await client.validatePostResponseAsync(body)) as { profile: Record<string, unknown> | null });
    } catch {
      throw new Error('saml: invalid response');
    }
    if (!profile) throw new Error('saml: no assertion');

    const attributes: Record<string, Json> = {};
    for (const [k, v] of Object.entries(profile)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)) {
        attributes[k] = v as Json;
      }
    }
    // Returned only when the assertion carries it, so the answer is unchanged for an IdP that does not.
    const sessionNotOnOrAfter = sessionNotOnOrAfterOf(profile);
    return {
      attributes,
      nameId: (profile.nameID as string | undefined) ?? null,
      nameIdFormat: (profile.nameIDFormat as string | undefined) ?? null,
      sessionIndex: (profile.sessionIndex as string | undefined) ?? null,
      assertionId: (profile.ID as string | undefined) ?? null,
      ...(sessionNotOnOrAfter !== null ? { sessionNotOnOrAfter } : {}),
    } as Json;
  },
};
