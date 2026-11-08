import { lookup } from 'node:dns/promises';
import {
  ipv4ToInt,
  isBlockedIp,
  matchesAllowEntry,
  isAddressAllowed,
} from '@kuraykaraaslan-labs/common/server/ip-guard';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * SSRF protection for outbound webhook deliveries.
 *
 * Webhook URLs are user-controlled, so a delivery is a server-side request to an
 * arbitrary host — a classic SSRF vector (e.g. pointing at `169.254.169.254` to
 * read cloud metadata, or `127.0.0.1`/internal ranges). We resolve the URL host
 * and reject private / loopback / link-local / metadata addresses, unless the
 * webhook carries an explicit `ipAllowlist` (operator override). Validate at
 * BOTH create/update time and delivery time (DNS rebinding defence).
 *
 * The IP-classification predicates live in `@kuraykaraaslan-labs/common/server/ip-guard`
 * so this guard and the shared `safe-fetch` egress client (which PINS the
 * validated IP for the connection, closing the rebinding window) share one
 * definition of "what may we connect to".
 */

/**
 * webhook.03: an AppError (422 VALIDATION_ERROR), so a refused URL is a client error at the route instead of a logged 500.
 * The name stays stable so callers (the delivery worker) can tell a refusal apart.
 */
export class WebhookSsrfError extends AppError {
  constructor(message: string) {
    super(message, 422, ErrorCode.VALIDATION_ERROR);
    this.name = 'WebhookSsrfError';
  }
}

/**
 * Synchronous, no-DNS pre-check for create/update time. Blocks obvious targets
 * (localhost, `.local`, and private/reserved IP literals) so admins get instant
 * feedback. The authoritative, DNS-rebinding-resistant check is the async
 * {@link assertSafeWebhookUrl} run at delivery time. An `ipAllowlist` only
 * NARROWS what may be reached (F.common.02): it is set by a tenant admin, so it
 * can never open a private or reserved address.
 */
export function assertSafeWebhookUrlSync(url: string, ipAllowlist?: string[] | null): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new WebhookSsrfError('Webhook URL is not a valid URL.');
  }

  const lowerHost = host.toLowerCase();
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost') || lowerHost.endsWith('.local')) {
    throw new WebhookSsrfError('Webhook URL must not target localhost. Add an explicit IP allowlist to override.');
  }

  // IPv6 literals in URLs are bracketed: http://[::1]/
  const ipLiteral = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const isIpLiteral = ipv4ToInt(ipLiteral) !== null || ipLiteral.includes(':');
  if (!isIpLiteral) return; // a domain — can't judge without DNS; delivery-time check handles it

  const allow = (ipAllowlist ?? []).filter(Boolean);
  if (allow.length > 0 && !allow.some((entry) => matchesAllowEntry(ipLiteral, entry))) {
    throw new WebhookSsrfError(`Webhook IP ${ipLiteral} is not in the configured allowlist.`);
  }
  if (isBlockedIp(ipLiteral)) {
    throw new WebhookSsrfError(`Webhook URL targets a private or reserved address (${ipLiteral}).`);
  }
}

/**
 * Resolve the URL host and assert it is safe to deliver to. Throws
 * {@link WebhookSsrfError} on a blocked address (or, with an allowlist, on any
 * address outside it). DNS failures also throw so we never deliver blind.
 *
 * NOTE: this validates but does not PIN — the caller's `fetch` re-resolves DNS,
 * leaving a rebinding window. Prefer `safeFetch` (which pins the validated IP)
 * for the actual request; this remains for create/update-time validation and as
 * a defence-in-depth pre-check.
 */
export async function assertSafeWebhookUrl(url: string, ipAllowlist?: string[] | null): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new WebhookSsrfError('Webhook URL is not a valid URL.');
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new WebhookSsrfError(`Could not resolve webhook host "${host}".`);
  }
  if (addresses.length === 0) {
    throw new WebhookSsrfError(`Webhook host "${host}" did not resolve to any address.`);
  }

  for (const { address } of addresses) {
    if (!isAddressAllowed(address, ipAllowlist)) {
      // The allowlist narrows (F.common.02): a private or reserved address is refused whether it is listed or not.
      const allow = (ipAllowlist ?? []).filter(Boolean);
      throw new WebhookSsrfError(
        allow.length > 0 && !isBlockedIp(address)
          // The resolved address is not echoed: the refusal now reaches the caller, and it must not map the internal DNS.
          ? 'Webhook host resolves to an address that is not in the configured IP allowlist.'
          : 'Webhook host resolves to a private or reserved address.',
      );
    }
  }
}

// Re-exported so existing importers of these predicates from webhook.ssrf keep working.
export { isBlockedIp, matchesAllowEntry } from '@kuraykaraaslan-labs/common/server/ip-guard';
