import Logger from '@kuraykaraaslan-labs/logger';
import { getDataSource, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { Tenant as TenantEntity } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url';

/**
 * Best-effort tenant-invitation notification mails. Wires the shared
 * `notification_mail` queue the same way `gift_card.notify` / `commerce_return`
 * do: the BullMQ/mail infra is pulled in via dynamic import only when a mail is
 * actually sent, and every failure is logged (never thrown) so a mail hiccup can
 * never block the invitation lifecycle or its HTTP route.
 */

/** Escape user-supplied text before interpolating it into an HTML mail body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/**
 * One send, through the dispatcher (PLAT-01) rather than the mail queue.
 *
 * The INVITEE is the interesting recipient here: they are not a member yet and
 * usually have no account at all, so this is the address-only case the
 * dispatcher's recipient shape was opened up for. The INVITER does have one,
 * and passing their `userId` is what lets their preferences and in-app inbox
 * work — so the caller supplies whichever it has.
 *
 * NORMAL, not CRITICAL: an invitation and its outcome are ordinary workspace
 * traffic. Nobody is locked out and no credential was minted; CRITICAL is for
 * notices a preference must never be able to silence, and spending it here
 * would erode what it means everywhere else.
 */
async function sendNotice(
  tenantId: string,
  to: { userId?: string; email: string },
  subject: string,
  html: string,
  idempotencyKey?: string,
): Promise<void> {
  const { default: NotificationService } = await import(
    '@kuraykaraaslan-labs/notification/server/notification.service'
  );
  await NotificationService.notify(
    tenantId,
    { userId: to.userId, email: to.email },
    { event: 'tenant_invitation.notice', category: 'workspace', title: subject, body: subject, data: { html } },
    { urgency: 'NORMAL', ...(idempotencyKey ? { idempotencyKey } : {}) },
  );
}

/** Resolve a tenant's display name for mail copy; falls back to a generic label. */
async function resolveTenantName(tenantId: string): Promise<string> {
  try {
    const tenant = await withTenantRepositoryFor(tenantId, TenantEntity, (repo) => repo.findOne({ where: { tenantId } }));
    return tenant?.name || 'your workspace';
  } catch {
    return 'your workspace';
  }
}

type InviteInput = {
  invitationId: string;
  email: string;
  memberRole: string;
  rawToken: string;
  /** The row's expiry, stated in the mail so text and link agree (MS-25). */
  expiresAt: Date;
};

/**
 * The invitation mail itself — the first contact an invitee ever gets.
 *
 * The copy is a real EJS template with the tenant's branding, so `notification_mail`
 * still RENDERS it; what moved here is the SEND. It used to queue straight onto
 * the mail transport from inside the channel module, which is the PLAT-01 bypass:
 * no preference check, no in-app copy for an invitee who does happen to have an
 * account, and no single place to see what this workspace sent. Both call sites
 * (create + resend) now share this one function, which is also why they no longer
 * resolve the tenant name themselves.
 *
 * Best-effort like its siblings: the invitation row is already committed when
 * this runs, and a mail hiccup must not turn a successful invite into a 500.
 */
export async function sendInvitationEmail(tenantId: string, input: InviteInput): Promise<void> {
  try {
    const tenantName = await resolveTenantName(tenantId);
    const { default: MailAccountTemplatesService } = await import(
      '@kuraykaraaslan-labs/notification_mail/server/notification_mail.account-templates.service'
    );
    const rendered = await MailAccountTemplatesService.renderTenantInvitation({
      tenantId,
      tenantName,
      memberRole: input.memberRole,
      rawToken: input.rawToken,
      expiresAt: input.expiresAt,
    });
    if (!rendered) return;
    // Keyed on the raw token, not the invitation: a resend rotates it, so the
    // second mail is a new message rather than a swallowed duplicate.
    await sendNotice(
      tenantId,
      { email: input.email },
      rendered.subject,
      rendered.html,
      `tenant-invitation-invite:${input.invitationId}:${input.rawToken}`,
    );
  } catch (err) {
    Logger.warn(`[tenant_invitation] invitation mail failed for ${input.invitationId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type ReminderInput = {
  invitationId: string;
  email: string;
  memberRole: string;
  rawToken: string;
  expiresAt: Date;
};

/**
 * Remind a still-PENDING invitee that their invitation is waiting. The caller
 * rotates the token first (only a raw token yields a usable accept link, since
 * only the hash is persisted), so this mail always carries a working link;
 * unlike a resend it does NOT extend the original expiry.
 */
export async function sendInvitationReminderEmail(tenantId: string, input: ReminderInput): Promise<void> {
  try {
    const tenantName = await resolveTenantName(tenantId);
    // Absolute, and on the tenant's OWN host when it has one — the recipient
    // opens this from a mail client with no session and no current origin.
    const acceptLink = await absoluteTenantUrl(tenantId, `/auth/invitation/accept?token=${input.rawToken}`);
    const declineLink = await absoluteTenantUrl(tenantId, `/auth/invitation/decline?token=${input.rawToken}`);
    const subject = `Reminder: your invitation to join ${tenantName} is waiting`;
    const html =
      `<p>This is a reminder that you still have a pending invitation to join `
        + `<strong>${escapeHtml(tenantName)}</strong> as <strong>${escapeHtml(input.memberRole)}</strong>.</p>`
      + `<p>It expires on <strong>${input.expiresAt.toDateString()}</strong>.</p>`
      + `<p><a href="${acceptLink}">Accept the invitation</a>`
        + ` &nbsp;&middot;&nbsp; <a href="${declineLink}">Decline</a></p>`;
    // The rotated token makes each reminder distinct, so successive reminders
    // are not swallowed as duplicates while a job's own retries still dedupe.
    await sendNotice(
      tenantId,
      { email: input.email },
      subject,
      html,
      `tenant-invitation-reminder:${input.invitationId}:${input.rawToken}`,
    );
  } catch (err) {
    Logger.warn(`[tenant_invitation] reminder mail failed for ${input.invitationId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type DecisionInput = {
  invitationId: string;
  invitedByUserId: string;
  inviteeEmail: string;
  decision: 'accepted' | 'declined' | 'expired';
};

/**
 * Notify the inviter about the final state of an invitation they sent (accepted,
 * declined, or expired). Best-effort: resolves the inviter's email from the
 * system data source and no-ops silently when the inviter or their email cannot
 * be found.
 */
export async function sendInvitationDecisionEmail(tenantId: string, input: DecisionInput): Promise<void> {
  try {
    const sysDs = await getDataSource();
    const inviter = await sysDs.getRepository(UserEntity).findOne({ where: { userId: input.invitedByUserId } });
    if (!inviter?.email) return;

    const tenantName = await resolveTenantName(tenantId);
    const invitee = escapeHtml(input.inviteeEmail);
    const name = escapeHtml(tenantName);

    const subject = input.decision === 'expired'
      ? `Your invitation to ${tenantName} has expired`
      : `Your invitation to ${tenantName} was ${input.decision}`;
    const html = input.decision === 'expired'
      ? `<p>Your invitation for <strong>${invitee}</strong> to join <strong>${name}</strong> `
          + `has expired without being accepted.</p>`
      : `<p><strong>${invitee}</strong> has ${input.decision} your invitation to join <strong>${name}</strong>.</p>`;

    await sendNotice(
      tenantId,
      { userId: input.invitedByUserId, email: inviter.email },
      subject,
      html,
      `tenant-invitation-${input.decision}:${input.invitationId}`,
    );
  } catch (err) {
    Logger.warn(`[tenant_invitation] decision mail failed for ${input.invitationId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
