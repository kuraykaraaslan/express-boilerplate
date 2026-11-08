import { createHash } from 'node:crypto';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Refusing a password that is already on a breach list.
 *
 * ### The password never leaves, and neither does its hash
 *
 * This uses the k-anonymity range API: the password is SHA-1'd locally, the
 * FIRST FIVE hex characters of that hash are sent, and the service answers with
 * every suffix it knows beginning with those five. The match happens here. The
 * remote end sees a prefix shared by tens of thousands of passwords and learns
 * nothing about which one was asked about — that property is the only reason
 * this is acceptable at all, and it is why the prefix length is not a knob.
 *
 * SHA-1 is not a security choice here. It is the range API's index, and the
 * hash is never stored or used as a credential.
 *
 * ### It fails OPEN, deliberately
 *
 * A breach-list outage must not stop somebody registering or changing their
 * password. The alternative — refusing every password because a third party is
 * down — turns an availability problem at somebody else's service into an
 * outage at ours, and the check is a hardening measure rather than an
 * authentication step. Every failure is logged so a silently-dead check is
 * visible in the logs rather than only in a breach report later.
 *
 * ### It is off unless the tenant turns it on
 *
 * It makes an outbound call on a credential path. A deployment that cannot make
 * outbound calls, or does not want a third party in that path at all, gets the
 * rest of the password policy and none of this.
 */

const RANGE_API = 'https://api.pwnedpasswords.com/range';

/**
 * How long to wait for the range API.
 *
 * Short on purpose: this sits in front of a form somebody is waiting on, and a
 * slow breach list must degrade into "not checked" rather than into a
 * registration that appears to hang.
 */
const TIMEOUT_MS = 2500;

export interface BreachCheckResult {
  /** True only when the password was positively found on a list. */
  breached: boolean;
  /** How many times it appears — what makes "123456" and a rare leak different. */
  count: number;
  /** True when the check could not run. NOT the same as `breached: false`. */
  skipped: boolean;
  reason?: 'disabled' | 'unreachable' | 'timeout' | 'bad_response';
}

/**
 * Ask whether this password appears on a public breach list.
 *
 * `skipped` and `breached: false` are deliberately different answers: one means
 * "we looked and it is not there", the other means "we could not look". A caller
 * that treats them alike is one that will quietly stop checking.
 */
export async function checkPasswordBreach(
  password: string,
  opts: { enabled?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BreachCheckResult> {
  if (opts.enabled === false) {
    return { breached: false, count: 0, skipped: true, reason: 'disabled' };
  }

  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);

  try {
    const response = await doFetch(`${RANGE_API}/${prefix}`, {
      signal: controller.signal,
      headers: {
        // Asks the API to pad the response with fake suffixes, so the SIZE of
        // the reply stops being a signal about the prefix on the wire.
        'Add-Padding': 'true',
        'User-Agent': 'next-boilerplate-auth',
      },
    });
    if (!response.ok) {
      Logger.warn(`[auth.breach-check] range API returned ${response.status}`);
      return { breached: false, count: 0, skipped: true, reason: 'bad_response' };
    }

    const body = await response.text();
    for (const line of body.split('\n')) {
      const [candidate, countText] = line.trim().split(':');
      if (candidate !== suffix) continue;
      const count = Number.parseInt(countText ?? '0', 10);
      // A padded line is a real-looking suffix with a count of 0; it must not be
      // read as a hit.
      if (!Number.isFinite(count) || count <= 0) break;
      return { breached: true, count, skipped: false };
    }
    return { breached: false, count: 0, skipped: false };
  } catch (error) {
    const aborted = (error as { name?: string }).name === 'AbortError';
    Logger.warn(`[auth.breach-check] ${aborted ? 'timed out' : 'unreachable'}: ${error}`);
    return { breached: false, count: 0, skipped: true, reason: aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
