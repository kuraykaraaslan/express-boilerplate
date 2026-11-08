import { NextRequest } from 'next/server';
import TenantAuthMessages from './tenant_session.messages';

export type TenantIdSource = 'header' | 'subdomain' | 'query' | 'body' | 'param';

/**
 * Extract tenant ID from various sources in the request
 * @param request - The Next.js request object
 * @param source - The source to extract tenant ID from
 * @param paramKey - Optional parameter key for query/body/param extraction
 * @returns The tenant ID or null
 */
export function extractTenantId(
  request: NextRequest,
  source: TenantIdSource = 'header',
  paramKey: string = 'tenantId'
): string | null {
  switch (source) {
    case 'header':
      return request.headers.get('x-tenant-id');

    case 'subdomain':
      const host = request.headers.get('host');
      if (!host) return null;
      // The port is not part of the label (`localhost:3000` in development).
      const subdomain = host.split(':')[0].split('.')[0];
      // Avoid matching localhost, www, api, etc.
      if (['localhost', 'www', 'api', '127'].includes(subdomain)) return null;
      return subdomain;

    case 'query':
      const url = new URL(request.url);
      return url.searchParams.get(paramKey);

    case 'param':
      // For dynamic routes like /api/tenant/[tenantId]
      // The calling code should pass this via paramKey
      return paramKey;

    case 'body':
      // Body extraction needs to be done by caller since we can't read body here
      return null;

    default:
      throw new Error(TenantAuthMessages.INVALID_TENANT_ID_SOURCE);
  }
}
