/**
 * Ingest authentication: a tenant ingest key from the `api_key` module (hashed at rest, shown once, scope `telemetry:write`). The
 * tenant is whatever the key belongs to; the URL's tenant and anything in the payload play no part.
 *
 * `api_key` is an OPTIONAL dependency (EXT-14): it is reached with `import()` behind `ifActive`, and without it ingest answers 503.
 * The verifier is a port so tests (and any other credential scheme) can replace it.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { BROWSER_SCOPE } from './telemetry.browser-keys';

export const INGEST_SCOPE = 'telemetry:write';

export interface IngestPrincipal {
  tenantId: string;
  apiKeyId: string;
  /** The key holds the PUBLIC browser scope, not `telemetry:write`: the ingest path applies the browser restrictions (`telemetry.browser-keys.ts`). */
  browser?: true;
}

export interface TelemetryKeyVerifier {
  /** Resolves the principal or throws an `AppError`. Never reveals why a key was refused. */
  verify(request: { headers: { get(name: string): string | null } }): Promise<IngestPrincipal>;
}

const REFUSED = () => new AppError('Invalid or unauthorized ingest key', 401, ErrorCode.UNAUTHORIZED);

export const apiKeyVerifier: TelemetryKeyVerifier = {
  async verify(request) {
    const mod = await ifActive(ROOT_TENANT_ID, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.service'));
    if (!mod) throw new AppError('Telemetry ingest is unavailable', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
    try {
      const key = await mod.default.verifyFromAuthHeader(request, undefined, INGEST_SCOPE);
      return { tenantId: key.tenantId, apiKeyId: key.apiKeyId };
    } catch (e) {
      // A throttled key stays throttled (the exporter should back off); every other refusal looks the same from outside.
      if (e instanceof AppError && e.statusCode === 429) throw e;
    }
    // Not a server key: is it a browser key? Its scope is checked by the same verifier, so the key's hash, expiry and IP rules apply as always.
    try {
      const key = await mod.default.verifyFromAuthHeader(request, undefined, BROWSER_SCOPE);
      return { tenantId: key.tenantId, apiKeyId: key.apiKeyId, browser: true };
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 429) throw e;
      throw REFUSED();
    }
  },
};

/** Is `observability` enabled for the key's tenant? A key of a tenant that switched the module off ingests nothing. */
export type TenantGate = (tenantId: string) => Promise<boolean>;

export const moduleEnabledGate: TenantGate = async (tenantId) => {
  const { getEnabledModuleIds } = await import('@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next');
  return (await getEnabledModuleIds(tenantId)).has('observability');
};
