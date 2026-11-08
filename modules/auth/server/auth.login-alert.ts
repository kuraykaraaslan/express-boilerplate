import MailTemplatesService from '@kuraykaraaslan-labs/notification_mail/server/notification_mail.templates.service';
import type { GeoLocation } from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.types';

/**
 * 38-security 3.6: the body of the "new sign-in" alert. It says WHAT signed in (browser and OS), from WHERE (IP and the located city and
 * country the session was stamped with) and WHEN, so the recipient can tell their own sign-in from somebody else's. An alert they cannot
 * judge is noise. Falls back to the generic notice when the rich template is unavailable.
 */
export async function renderLoginAlertHtml(input: {
  tenantId: string;
  user: { email: string; name?: string | null };
  userAgent?: string;
  ipAddress?: string;
  geo?: Partial<GeoLocation> | null;
  at?: Date;
}): Promise<string | undefined> {
  const { tenantId, user } = input;
  // Loaded on demand: the rich template and the UA/geo helpers are heavy, and any failure here must fall back to the generic notice.
  try {
    const [{ default: MailAccountTemplatesService }, { default: UserAgentService }, { formatLocation }] = await Promise.all([
      import('@kuraykaraaslan-labs/notification_mail/server/notification_mail.account-templates.service'),
      import('@kuraykaraaslan-labs/common/server/user_agent/user_agent.service'),
      import('@kuraykaraaslan-labs/common/server/user_agent/user_agent.geo'),
    ]);
    let device = 'an unknown device';
    if (input.userAgent) {
      const info = UserAgentService.parseUserAgent(input.userAgent);
      const parts = [info.browserName, info.osName].filter((p) => p && !/^unknown$/i.test(String(p)));
      if (parts.length) device = parts.join(' on ');
    }
    const location = input.geo && (input.geo.city || input.geo.country) ? formatLocation(input.geo as GeoLocation) : 'an unknown location';
    const rich = await MailAccountTemplatesService.renderNewDeviceAlert({
      tenantId, email: user.email, name: user.name ?? undefined,
      device, ip: input.ipAddress ?? 'unknown', location, loginTime: (input.at ?? new Date()).toISOString(),
    });
    if (rich?.html) return rich.html;
  } catch {
    // fall through to the generic notice
  }
  return MailTemplatesService.renderNewLoginEmail({ tenantId, email: user.email }) as Promise<string | undefined>;
}
