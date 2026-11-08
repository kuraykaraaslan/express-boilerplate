// crypto: HOST-SIDE, vetted JWT/JWKS verification. Trust-critical signature checks
// (e.g. OIDC id_token verification for sandboxed identity providers) must NOT happen
// in the untrusted isolate. The isolate hands the raw token + the JWKS URI here; the
// broker fetches the keys, verifies signature + iss/aud/exp/nonce, returns ONLY the
// verified claims.
import { createPublicKey, createSign, type KeyObject, createHmac, createHash, randomBytes, verify as cryptoVerify, type JsonWebKey, type BinaryToTextEncoding } from 'node:crypto';
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch';
import jwt from 'jsonwebtoken';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { assertSafeWebhookUrl } from '@kuraykaraaslan-labs/webhook/server/webhook.ssrf';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { pluginRuntimeXmlSignerLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/plugin_runtime.xml_signer';
import type { Json } from '../../../sdk/types';
import { SECRET_PREFIX, configTenantOf, type BrokerCtx } from '../broker.context';

/** The XML signer point (e_signature contributes it); the shape is e_signature/server/e_signature.plugin-xml-signer.ts. */
export const XML_SIGNER_POINT = 'plugin_runtime:xml_signer';
interface XmlSigner {
  signXml?: (tenantId: string, xml: string, params: { keyKey: string; certKey: string; xpath?: string; prefix?: string }) => Promise<{ xml: string; signed: boolean }>;
}

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32-byte raw key follows it. */
const ED25519_SPKI_PREFIX = '302a300506032b6570032100';

// There used to be a pair of constants here defaulting to the tenant's INVOICE
// seal — `invoiceSigningKeyPem` / `invoiceSigningCertPem` — copied from
// `invoice.signature.service` with a comment saying so. Two problems, and the
// second is the serious one (PLAT-10, audit 2026-08):
//
//  1. A business module's setting names were spelled a second time inside the
//     generic sandbox broker. `invoice` owns those keys; renaming one there
//     would have left this copy silently reading nothing.
//  2. More importantly, it meant `signXml()` with no options applied the
//     tenant's qualified invoice seal to ARBITRARY plugin-supplied XML. A
//     sandboxed plugin should not reach a tenant's fiscal signing key by
//     omitting an argument.
//
// The keys are now required: a caller names the setting pair it wants, so the
// module that owns a seal is the only thing that knows its key names.

const HASH_ALGOS = new Set(['sha256', 'sha384', 'sha512', 'sha1']);
const HASH_ENCODINGS = new Set(['hex', 'base64', 'base64url']);

/** A secret name as the config route stores it (and as `{{secret:NAME}}` spells it). */
const SECRET_NAME = /^[A-Za-z0-9_]{1,64}$/;

/** `secret:NAME` (one of the calling plugin's own secrets) as its stored setting key; anything else is refused (plugin_runtime.01). */
function ownSecretKey(ctx: BrokerCtx, ref: unknown): string {
  const m = /^secret:([A-Za-z0-9_]{1,64})$/.exec(String(ref ?? ''));
  if (!m) throw new Error("crypto.signXml: keyKey and certKey must name this plugin's own secrets as secret:NAME");
  return SECRET_PREFIX(ctx.pluginId) + m[1];
}

// verifyRsa bounds. An RSA-8192 signature is 1024 bytes (1368 base64 characters); a PEM SPKI of that size is under 1.6 KB.
const RSA_VERIFY_ALGOS = new Set(['RSA-SHA256']);
const RSA_MAX_DATA_BYTES = 2_000_000;
const RSA_MAX_SIGNATURE_CHARS = 1400;
const RSA_MAX_KEY_CHARS = 8192;
const RSA_MIN_MODULUS_BITS = 2048;
const RSA_INVALID_KEY = 'verifyRsa: invalid public key';

/**
 * Parse an RSA public key: a PEM `PUBLIC KEY` / `RSA PUBLIC KEY` block, or the bare base64 SPKI some consoles hand
 * out (Alipay's "Alipay public key" is one). Anything else, a non-RSA key or a modulus under 2048 bits is refused
 * with one fixed error that never quotes the input.
 */
function rsaPublicKey(input: unknown): KeyObject {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > RSA_MAX_KEY_CHARS) throw new Error(RSA_INVALID_KEY);
  let key: KeyObject;
  try {
    if (/^-----BEGIN (RSA )?PUBLIC KEY-----/.test(text)) {
      key = createPublicKey({ key: text, format: 'pem' });
    } else {
      const b64 = text.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error(RSA_INVALID_KEY);
      key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    }
  } catch {
    throw new Error(RSA_INVALID_KEY);
  }
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < RSA_MIN_MODULUS_BITS) {
    throw new Error(RSA_INVALID_KEY);
  }
  return key;
}

export const crypto = {

  // Cryptographically-strong random bytes for plugins that have no isolate RNG
  // (e.g. Smart-ID's per-login nonce). Returns the bytes in the requested encoding.
  // No secret involved — pure host primitive the V8 isolate lacks.
  randomBytes(_ctx: BrokerCtx, n: number, encoding?: string): Json {
    const len = Math.max(1, Math.min(Number(n) || 0, 1024));
    const enc = HASH_ENCODINGS.has(String(encoding)) ? (encoding as BufferEncoding) : 'base64';
    return randomBytes(len).toString(enc) as Json;
  },

  // Ed25519 signature check over a message (Discord interaction webhooks sign
  // `timestamp + body` this way). The PUBLIC key and the signature arrive as hex —
  // nothing secret is involved; the isolate simply has no Ed25519 primitive. Returns
  // false for any malformed input rather than throwing, so a forged request is a
  // plain "not authentic", never a plugin error.
  verifyEd25519(_ctx: BrokerCtx, message: string, signatureHex: string, publicKeyHex: string): Json {
    try {
      if (!/^[0-9a-fA-F]{64}$/.test(String(publicKeyHex)) || !/^[0-9a-fA-F]{128}$/.test(String(signatureHex))) return false;
      const key = createPublicKey({
        key: Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX, 'hex'), Buffer.from(publicKeyHex, 'hex')]),
        format: 'der',
        type: 'spki',
      });
      return cryptoVerify(null, Buffer.from(String(message), 'utf8'), key, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  },

  // Digest of one or more byte parts, concatenated HOST-SIDE so the isolate never
  // has to do binary concat (it can't, without Buffer). Each part declares its own
  // encoding ('utf8' | 'base64' | 'hex'); the result is returned in `outputEncoding`.
  // Pure (no secret) — gives sandboxed providers SHA-256/384/512 hashing.
  hash(
    _ctx: BrokerCtx,
    parts: Array<{ value: string; encoding?: string }>,
    opts?: { algorithm?: string; outputEncoding?: string },
  ): Json {
    const algorithm = HASH_ALGOS.has(String(opts?.algorithm)) ? opts!.algorithm! : 'sha256';
    const outEnc = HASH_ENCODINGS.has(String(opts?.outputEncoding)) ? (opts!.outputEncoding as BinaryToTextEncoding) : 'base64';
    const h = createHash(algorithm);
    for (const p of parts ?? []) {
      const enc = (['utf8', 'base64', 'hex'].includes(String(p?.encoding)) ? p.encoding : 'utf8') as BufferEncoding;
      h.update(Buffer.from(String(p?.value ?? ''), enc));
    }
    return h.digest(outEnc) as Json;
  },

  // XAdES / XML-DSig signing for sandboxed document plugins (e.g. e-invoicing
  // adapters). The XML-signing engine and the tenant's seal private key stay
  // HOST-SIDE — the isolate only hands over the XML to be enveloped-signed and
  // gets back the signed XML. When no seal is configured the original XML is
  // returned unchanged (signature is optional for most regimes).
  //
  // `keyKey` / `certKey` name the plugin's own secret pair holding the seal (`secret:NAME`) and are
  // REQUIRED: a plugin has to say which seal it is asking for. Omitting them
  // used to fall back to the invoice seal — see the note at the top of this file.
  async signXml(
    ctx: BrokerCtx,
    xml: string,
    opts: { keyKey: string; certKey: string; xpath?: string; prefix?: string },
  ): Promise<Json> {
    if (!opts?.keyKey || !opts?.certKey) {
      throw new Error('crypto.signXml requires keyKey and certKey — name the tenant setting pair holding the seal');
    }
    // plugin_runtime.01: the seal must be the plugin's OWN, named as `secret:NAME` and read from its secret namespace
    // (`plugin_secret:<pluginId>:NAME`). A bare setting name reached ANY tenant setting, e.g. the tenant's qualified invoice
    // seal (`invoiceSigningKeyPem`), and applied it to plugin-chosen XML.
    const keyKey = ownSecretKey(ctx, opts.keyKey);
    const certKey = ownSecretKey(ctx, opts.certKey);
    // The seal is e_signature's, reached through the point `plugin_runtime:xml_signer` (this module is Core, e_signature is Pro). With no
    // signer for the tenant the XML comes back unsigned, exactly as when the tenant has no seal configured.
    const params = { keyKey, certKey, xpath: opts.xpath, prefix: opts.prefix };
    const answered = await ext.first<XmlSigner, { xml: string; signed: boolean }>(
      XML_SIGNER_POINT, tenantCtx(ctx.tenantId, { scope: 'tenant' }), pluginRuntimeXmlSignerLoaders,
      (signer) => (signer.signXml ? signer.signXml(configTenantOf(ctx), String(xml), params) : null),
      { validate: (r) => r == null || (typeof r === 'object' && typeof r.xml === 'string') },
    );
    return (answered?.value?.xml ?? String(xml)) as Json;
  },
  // Sign a JWT with a private key read HOST-SIDE from the plugin's encrypted secrets
  // (e.g. Apple's `client_secret` client-assertion). The signing key never enters the
  // isolate; the isolate only supplies the claims + signing parameters.
  async signJwt(
    ctx: BrokerCtx,
    claims: Record<string, unknown>,
    opts?: { algorithm?: string; keyid?: string; secretName?: string; expiresInSec?: number },
  ): Promise<Json> {
    const o = opts ?? {};
    const raw = await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + (o.secretName ?? 'signingKey'));
    const key = decryptFieldOpt(raw);
    if (typeof key !== 'string' || !key) throw new Error('signJwt: signing key not set');
    const algorithm = (o.algorithm ?? 'ES256') as jwt.Algorithm;
    return jwt.sign(claims as object, key, {
      algorithm,
      ...(o.keyid ? { keyid: o.keyid } : {}),
      ...(o.expiresInSec ? { expiresIn: o.expiresInSec } : {}),
    }) as Json;
  },

  // Sign arbitrary data with a private key from the plugin's encrypted secrets
  // (e.g. Alipay's RSA2 request signature). Key stays host-side; returns base64.
  async signData(ctx: BrokerCtx, data: string, opts?: { algorithm?: string; secretName?: string }): Promise<Json> {
    const o = opts ?? {};
    const raw = await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + (o.secretName ?? 'signingKey'));
    const key = decryptFieldOpt(raw);
    if (typeof key !== 'string' || !key) throw new Error('signData: signing key not set');
    const signer = createSign(o.algorithm ?? 'RSA-SHA256');
    signer.update(String(data));
    signer.end();
    return signer.sign(key, 'base64') as Json;
  },

  // Keyed HMAC over arbitrary data (e.g. iyzico's IYZWSv2 signature, or an AWS
  // SigV4 signing-key chain). Two keying modes:
  //   • secretName (+ optional prefix) — key = prefix + the plugin's host-side secret
  //     (e.g. prefix 'AWS4' for SigV4's kDate step). The secret never enters the isolate.
  //   • key { value, encoding } — an explicit binary key passed in, for the SigV4 chain
  //     steps that key off the PREVIOUS hmac's (non-secret) digest.
  // appendSecret names a SECOND plugin secret whose value is appended to the signed data
  // host-side: PayTR signs hmac(data + merchant_salt, merchant_key) with both secrets. It
  // is read like the key secret (the plugin's own namespace, which holds only the secrets
  // its manifest declares) and refused when unset; it is refused with an explicit `key`,
  // where the isolate would hold the key and could test guesses of the appended secret.
  async hmac(
    ctx: BrokerCtx,
    data: string,
    opts?: { secretName?: string; prefix?: string; key?: { value: string; encoding?: string }; appendSecret?: string; algorithm?: string; encoding?: string },
  ): Promise<Json> {
    const o = opts ?? {};
    const explicitKey = !!(o.key && typeof o.key.value === 'string');
    let suffix = '';
    if (o.appendSecret !== undefined) {
      if (explicitKey) throw new Error('hmac: appendSecret needs a secret key');
      if (typeof o.appendSecret !== 'string' || !SECRET_NAME.test(o.appendSecret)) throw new Error('hmac: appendSecret not set');
      const appended = decryptFieldOpt(await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + o.appendSecret));
      if (typeof appended !== 'string' || !appended) throw new Error('hmac: appendSecret not set');
      suffix = appended;
    }
    let key: Buffer | string;
    if (explicitKey) {
      key = Buffer.from(o.key!.value, (o.key!.encoding ?? 'hex') as BufferEncoding);
    } else {
      const raw = await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + (o.secretName ?? 'signingKey'));
      const secret = decryptFieldOpt(raw);
      if (typeof secret !== 'string' || !secret) throw new Error('hmac: key not set');
      key = (o.prefix ?? '') + secret;
    }
    const h = createHmac(o.algorithm ?? 'sha256', key);
    h.update(String(data) + suffix);
    return h.digest((o.encoding ?? 'hex') as BinaryToTextEncoding) as Json;
  },

  // RSA signature check (RSA-SHA256, PKCS#1 v1.5) against a PUBLIC key the plugin passes
  // in — typically its own non-secret setting, e.g. the Alipay public key that signs every
  // OpenAPI answer. Nothing secret is involved; the isolate has no RSA primitive. A forged
  // or malformed signature is a plain `false`; a malformed / non-RSA / short key, an
  // unsupported algorithm or oversized data is a fixed error, so a misconfiguration is
  // visible and never reads as "not authentic".
  verifyRsa(_ctx: BrokerCtx, data: string, signatureBase64: string, publicKey: string, opts?: { algorithm?: string }): Json {
    const algorithm = opts?.algorithm ?? 'RSA-SHA256';
    if (!RSA_VERIFY_ALGOS.has(String(algorithm))) throw new Error('verifyRsa: unsupported algorithm');
    const message = Buffer.from(String(data ?? ''), 'utf8');
    if (message.length > RSA_MAX_DATA_BYTES) throw new Error('verifyRsa: data too large');
    const key = rsaPublicKey(publicKey);
    const sig = typeof signatureBase64 === 'string' ? signatureBase64.trim() : '';
    if (!sig || sig.length > RSA_MAX_SIGNATURE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) return false;
    try {
      return cryptoVerify('RSA-SHA256', message, key, Buffer.from(sig, 'base64'));
    } catch {
      return false;
    }
  },

  async verifyJwks(
    ctx: BrokerCtx,
    token: string,
    jwksUri: string,
    expected?: { issuer?: string; audience?: string; nonce?: string },
  ): Promise<Json> {
    const decoded = jwt.decode(String(token), { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) {
      throw new Error('jwt: undecodable or missing kid');
    }
    let parsed: URL;
    try { parsed = new URL(String(jwksUri)); } catch { throw new Error('jwt: invalid jwksUri'); }
    if (parsed.protocol !== 'https:') throw new Error('jwt: jwksUri must be https');
    // plugin_runtime.04: the JWKS fetch is egress like any other, so it is held to the plugin's http allowlist: without it a
    // plugin with `crypto` alone (or a narrow allowlist) could make the broker GET any public host.
    if (!ctx.httpAllowlist.includes(parsed.host)) throw new Error(`jwt: jwksUri host not in allowlist: ${parsed.host}`);
    await assertSafeWebhookUrl(parsed.toString()); // SSRF-guard the JWKS fetch

    // safeFetch pins the validated IP; JWKS endpoints are direct — do not follow redirects.
    const res = await safeFetch(parsed.toString(), { redirect: 'manual', signal: AbortSignal.timeout(ctx.limits.httpTimeoutMs) });
    if (!res.ok) throw new Error(`jwt: jwks fetch ${res.status}`);
    const body = (await res.json()) as { keys?: Array<Record<string, unknown> & { kid?: string }> };
    const jwk = (body.keys ?? []).find((k) => k.kid === decoded.header.kid);
    if (!jwk) throw new Error('jwt: no matching JWKS key');

    const key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
    const e = expected ?? {};
    const claims = jwt.verify(String(token), key, {
      algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'],
      issuer: e.issuer || undefined,
      audience: e.audience || undefined,
      clockTolerance: 60,
    }) as Record<string, unknown>;
    if (e.nonce && claims.nonce !== e.nonce) throw new Error('jwt: nonce mismatch');
    return claims as Json;
  },
};
