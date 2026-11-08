import { env } from '@kuraykaraaslan-labs/env';
import { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor, ipListVerdict } from '@kuraykaraaslan-labs/ip_subnet';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import SettingService from './tenant_setting.service';
import { IP_LIST_KEYS, validateSettingValue } from './tenant_setting.validation';

/**
 * Refuse a settings write that would put its own writer outside the tenant's IP allow/deny lists
 * (`ipWhitelist` / `ipBlacklist`, enforced on every tenant request by tenant_session.policy.ts from the moment they are
 * written). The lists after the write are the written values over the tenant's own current ones (never ROOT's: the
 * lists do not inherit). The writer's IP is read exactly as the enforcement reads it: X-Forwarded-For through
 * `TRUSTED_PROXY_HOPS` trusted proxies (tenant_session.client-ip.ts; inlined here because tenant_session imports this
 * module). No-op when the write touches neither list.
 *
 * `exempt`: the writer is not subject to the lists at all (`TenantAuthResult.ipListsExempt`: a platform admin, a
 * system-flow impersonation, a break-glass session for this tenant), so it can set a customer's lists from anywhere. Refuses with 409 CONFLICT before anything is written or queued.
 */
export async function assertIpListWriteKeepsWriter(
  tenantId: string,
  settings: Record<string, unknown>,
  request: { headers: Pick<Headers, 'get'> },
  { exempt = false }: { exempt?: boolean } = {},
): Promise<void> {
  const written = Object.keys(settings).filter((k) => IP_LIST_KEYS.has(k));
  if (written.length === 0) return;
  // A malformed entry gets its own 400 (which the write would give anyway), not a lockout verdict on a rule nobody matches.
  for (const key of written) if (typeof settings[key] === 'string') validateSettingValue(key, settings[key] as string);

  // 38-security 2.2: the platform-global blocklist binds EVERYONE at the auth surfaces, platform admins included, so the writer's own
  // exemption never applies to it: a rule that would block the editor's address is a 409.
  const globalList = settings['globalIpBlacklist'];
  if (typeof globalList === 'string' && isRootTenant(tenantId)) {
    const wip = clientIpFromForwardedFor(request.headers.get('x-forwarded-for'), env.TRUSTED_PROXY_HOPS ?? DEFAULT_TRUSTED_PROXY_HOPS);
    if (wip && ipListVerdict(wip, globalList, undefined) === 'blocked') {
      throw new AppError(`This global blocklist would block your own address (${wip}) from signing in. Remove it from globalIpBlacklist.`, 409, ErrorCode.CONFLICT);
    }
  }
  if (exempt) return;

  const own = await SettingService.getAll(tenantId);
  const after = (key: string): string | undefined => {
    if (key in settings) return typeof settings[key] === 'string' ? (settings[key] as string) : undefined;
    return own.find((s) => s.key === key)?.value;
  };
  const ip = clientIpFromForwardedFor(request.headers.get('x-forwarded-for'), env.TRUSTED_PROXY_HOPS ?? DEFAULT_TRUSTED_PROXY_HOPS);
  if (ipListVerdict(ip, after('ipBlacklist'), after('ipWhitelist')) === 'allowed') return;

  // `details.key` / `keys`: the settings page shows the refusal under the list(s) the write changed (MS-39).
  const changed = written.filter((k) => k !== 'globalIpBlacklist');
  throw new AppError(
    ip
      ? `These IP lists would refuse your own address (${ip}) and lock you out of this tenant. Add it to ipWhitelist or remove it from ipBlacklist.`
      : 'These IP lists would lock you out of this tenant: your request carries no client address an allow list can match.',
    409,
    ErrorCode.CONFLICT,
    { details: { key: changed[0], keys: changed, reason: 'IP_LISTS_LOCK_OUT_WRITER' } },
  );
}
