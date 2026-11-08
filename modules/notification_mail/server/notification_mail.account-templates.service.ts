import { env } from "@kuraykaraaslan-labs/env";
import Logger from "@kuraykaraaslan-labs/logger";
import MailService from "./notification_mail.service";
import { getBaseTemplateVars } from "./notification_mail.template-vars";
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url';

/** A rendered mail the CALLER sends — `null` when the template failed. */
export interface RenderedMail { subject: string; html: string }

/**
 * Email templates for account/security events (email/password changes, security
 * alerts) plus tenant invitations and contact-form mails. Auth/OTP and invoice
 * templates live in `MailTemplatesService`.
 *
 * ## `render*` vs `send*`
 *
 * Everything with a live caller is now `render…` and hands back
 * `{ subject, html }` instead of putting anything on the queue. Sending is the
 * DOMAIN's decision — `user_security` knows a password just changed and that
 * the notice must be CRITICAL, `auth` knows a verification link is critical and
 * an invitation is not — and this module is a channel BEHIND the dispatcher. A
 * channel that reaches around its own dispatcher to send is the PLAT-01 shape
 * inverted, so the send moved to the caller and only the rendering stayed here.
 *
 * ## Why the contact-form pair still queues directly
 *
 * `sendContactFormAdminEmail` needs a `replyTo` header pointing at the visitor —
 * its template tells the operator to "reply directly to" them, and the promise
 * in the body has to be backed by the header that makes it true. The dispatcher
 * carries no per-message envelope override (`NotificationEvent.data` reaches the
 * mail channel, but the channel only reads `data.html`), so migrating that send
 * would silently drop the header. Both contact-form methods also have ZERO
 * production callers today — the form does not send mail at all — so this is a
 * capability gap to close in the channel provider before the migration, not a
 * live bypass. See `modules/notification/README.md` (PLAT-01 table).
 */
export default class MailAccountTemplatesService {

  static async renderEmailChanged({ email, name, tenantId }: { email: string; name?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = "Your Email Was Updated";
      const html = await MailService.renderTemplate("email_change.ejs", {
        ...vars,
        subject,
        user: { name: name || email },
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderEmailChanged error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Email verification
   */
  static async renderVerifyEmail({
    email,
    name,
    verifyToken,
    subject: subjectOverride,
    tenantId,
  }: {
    email: string;
    name?: string;
    verifyToken: string;
    subject?: string;
    tenantId?: string;
  }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = subjectOverride || "Verify Your Email";
      const verifyLink =
        vars.baseUrl + "/auth/verify-email?token=" + verifyToken + "&email=" + email;
      const html = await MailService.renderTemplate("verify_email.ejs", {
        ...vars,
        subject,
        user: { name: name || email },
        verifyLink,
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderVerifyEmail error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Passwordless sign-in link (backlog F10 §1). RENDER ONLY — `auth` sends it,
   * critically, because it is an account-access credential.
   */
  static async renderMagicLinkEmail({
    email,
    name,
    tenantId,
    token,
    subject: subjectOverride,
  }: {
    email: string;
    name?: string;
    tenantId: string;
    token: string;
    subject?: string;
  }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = subjectOverride || "Your sign-in link";
      const magicLink =
        `${vars.baseUrl}/${tenantId}/login/magic?token=${encodeURIComponent(token)}`;
      const html = await MailService.renderTemplate("magic_link.ejs", {
        ...vars,
        subject,
        user: { name: name || email },
        magicLink,
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderMagicLinkEmail error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Password changed notification
   */
  static async renderPasswordChanged({ email, name, tenantId }: { email: string; name?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = "Your Password Was Changed";
      const html = await MailService.renderTemplate("password_changed.ejs", {
        ...vars,
        subject,
        user: { name: name || email },
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderPasswordChanged error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Suspicious activity alert
   */
  static async renderSuspiciousActivity({
    email,
    name,
    eventType,
    ip,
    location,
    attemptTime,
    tenantId,
  }: {
    email: string;
    name?: string;
    eventType: string;
    ip: string;
    location: string;
    attemptTime: string;
    tenantId?: string;
  }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = "Suspicious Activity Detected";
      const html = await MailService.renderTemplate("suspicious_activity.ejs", {
        ...vars,
        subject,
        user: { name: name || email },
        eventType,
        ip,
        location,
        attemptTime,
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderSuspiciousActivity error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * New device login alert
   */
  static async renderNewDeviceAlert({
    email,
    name,
    device,
    ip,
    location,
    loginTime,
    tenantId,
  }: {
    email: string;
    name?: string;
    device: string;
    ip: string;
    location: string;
    loginTime: string;
    tenantId?: string;
  }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = "New Device Login Detected";
      const html = await MailService.renderTemplate("new_device_alert.ejs", {
        ...vars,
        subject,
        user: { name: name || email },
        device,
        ip,
        location,
        loginTime,
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderNewDeviceAlert error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Tenant invitation email.
   *
   * The stated expiry is the invitation's own `expiresAt` (MS-25), so the text and the link always agree: the tenant's
   * `invitationTtlDays` (capped at the installation default) and a resend that renews the date are both what the row says.
   * Before, the mail stated `INVITATION_TTL_SECONDS` whatever the tenant had set. A caller that passes no `expiresAt` gets
   * the installation default, as before.
   */
  static async renderTenantInvitation({
    tenantName,
    memberRole,
    rawToken,
    tenantId,
    expiresAt,
    now = new Date(),
  }: {
    tenantName: string;
    memberRole: string;
    rawToken: string;
    tenantId: string;
    /** The invitation row's expiry: the one the accept link is judged by. */
    expiresAt?: Date | null;
    now?: Date;
  }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = `You've been invited to join ${tenantName}`;
      const { expiryDays, expiresOn } = invitationExpiry(expiresAt, now);
      // Absolute, and on the tenant's OWN host when it has one: the invitee
      // opens this from a mail client with no session and no current origin.
      // Without tenant_domain it is the platform host's /tenant/{id} form, which
      // still lands on the right tenant, so the invitation is sent either way.
      const invitationLink = await absoluteTenantUrl(tenantId, `/auth/invitation/accept?token=${rawToken}`);
      const declineLink = await absoluteTenantUrl(tenantId, `/auth/invitation/decline?token=${rawToken}`);
      const html = await MailService.renderTemplate("tenant_invitation.ejs", {
        ...vars,
        subject,
        tenantName,
        memberRole,
        expiryDays,
        expiresOn,
        invitationLink,
        declineLink,
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.renderTenantInvitation error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Contact form submission - Admin notification
   */
  static async sendContactFormAdminEmail({
    tenantId,
    message,
    name,
    email,
    phone,
  }: {
    tenantId: string;
    message: string;
    name: string;
    email: string;
    phone: string;
  }): Promise<void> {
    if (!MailService.INFORM_MAIL) return;
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = "New Contact Form Message";
      const emailContent = await MailService.renderTemplate("contact_form_admin.ejs", {
        ...vars,
        subject,
        message,
        name,
        email,
        phone,
      });
      // `replyTo` is the visitor, not the no-reply sender. The template tells the
      // operator to "reply directly to" them, and without this the reply would
      // go to MAIL_FROM — the promise in the body has to be backed by the header
      // that makes it true. (Possible only since `MailSendExtras` existed;
      // before that `_sendMail` dropped `replyTo` on the floor.)
      await MailService.sendMail(
        tenantId, MailService.INFORM_MAIL, subject, emailContent, undefined, undefined,
        { replyTo: email },
      );
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.sendContactFormAdminEmail error: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Contact form submission - User confirmation
   */
  static async sendContactFormUserEmail({ tenantId,
    name, email }: { tenantId: string;
    name: string; email: string }): Promise<void> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = "We Received Your Message";
      const emailContent = await MailService.renderTemplate("contact_form_user.ejs", {
        ...vars,
        subject,
        user: { name },
      });
      await MailService.sendMail(tenantId, email, subject, emailContent);
    } catch (error: unknown) {
      Logger.error(`MailAccountTemplatesService.sendContactFormUserEmail error: ${error instanceof Error ? error.message : error}`);
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the invitation mail says about its expiry. From the row's `expiresAt` when given (whole days left, rounded, at least 1,
 * and the exact UTC moment); else the installation default `INVITATION_TTL_SECONDS` (7 days) with no date, as before.
 */
export function invitationExpiry(expiresAt: Date | null | undefined, now: Date = new Date()): { expiryDays: number; expiresOn: string | null } {
  if (expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())) {
    return {
      expiryDays: Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / DAY_MS)),
      expiresOn: expiresAt.toUTCString(),
    };
  }
  const ttlSeconds = env.INVITATION_TTL_SECONDS ?? (60 * 60 * 24 * 7);
  return { expiryDays: Math.round(ttlSeconds / (60 * 60 * 24)), expiresOn: null };
}
