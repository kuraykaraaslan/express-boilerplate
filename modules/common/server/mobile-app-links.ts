import { env } from '@kuraykaraaslan-labs/env';

/**
 * The native app's identity, as the operating systems want to read it.
 *
 * One place because two features hang off the same facts:
 *  - passkeys: the OS only lets an app use the RP ID's passkeys if the RP domain vouches for
 *    it (Android `assetlinks.json`, iOS `webcredentials`), and the WebAuthn ceremony then
 *    reports an app-specific origin the server has to accept;
 *  - universal / app links: the invitation e-mail's https link opens the app instead of a
 *    browser only if the same files say so.
 *
 * Everything comes from env and nothing is invented: with the variables unset the documents
 * are `null` and the routes answer 404.
 */

function list(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

/** Paths the app claims as links: the e-mailed invitation accept/decline pages (domain and path tenancy). */
const APP_LINK_PATHS = ['/auth/invitation/*', '/t/*/auth/invitation/*'];

/** `AA:BB:…` (colon-hex SHA-256) → the base64url string Android puts in `android:apk-key-hash:`. */
export function certFingerprintToApkKeyHash(fingerprint: string): string | null {
  const hex = fingerprint.replace(/:/g, '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex').toString('base64url');
}

/** The WebAuthn origins the Android app reports, derived from its signing certificates. */
export function androidWebAuthnOrigins(): string[] {
  return list(env.MOBILE_ANDROID_CERT_SHA256)
    .map(certFingerprintToApkKeyHash)
    .filter((hash): hash is string => hash !== null)
    .map((hash) => `android:apk-key-hash:${hash}`);
}

/** Every origin besides the web one that a passkey ceremony may legitimately come from. */
export function extraWebAuthnOrigins(): string[] {
  return [...new Set([...list(env.WEBAUTHN_EXTRA_ORIGINS), ...androidWebAuthnOrigins()])];
}

/**
 * Hosts allowed to serve the association files (`MOBILE_LINK_HOSTS`, comma-separated, hostnames
 * only). A passkey / app link only works on the RP ID host, so on any other host the files are
 * a false claim. Unset = serve on every host (the old behaviour); set = serve only on these,
 * which also confines the `/t/{id}/…` path-mode claim to the platform host.
 */
export function isAssociationHost(hostHeader: string | null | undefined): boolean {
  const allowed = list(env.MOBILE_LINK_HOSTS).map((h) => h.toLowerCase());
  if (allowed.length === 0) return true;
  const host = (hostHeader ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  return allowed.includes(host);
}

/** `/.well-known/assetlinks.json`, or null when no Android app is configured. */
export function assetLinksDocument(): unknown[] | null {
  const packageName = env.MOBILE_ANDROID_PACKAGE_NAME?.trim();
  const fingerprints = list(env.MOBILE_ANDROID_CERT_SHA256).map((f) => f.toUpperCase());
  if (!packageName || fingerprints.length === 0) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }];
}

/** `/.well-known/apple-app-site-association`, or null when no iOS app is configured. */
export function appleAppSiteAssociationDocument(): Record<string, unknown> | null {
  const appIds = list(env.MOBILE_IOS_APP_IDS);
  if (appIds.length === 0) return null;
  return {
    applinks: { details: [{ appIDs: appIds, components: APP_LINK_PATHS.map((path) => ({ '/': path })) }] },
    webcredentials: { apps: appIds },
  };
}
