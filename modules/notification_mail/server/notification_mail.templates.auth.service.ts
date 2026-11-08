import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import MailService from './notification_mail.service';
import { getBaseTemplateVars } from './notification_mail.template-vars';
import NotificationMailMessages from './notification_mail.messages';
import type { RenderedMail } from './notification_mail.account-templates.service';

/**
 * Auth / OTP email BODIES. Rendering only — nothing here queues a message.
 *
 * `notification_mail` is a channel behind the dispatcher, so the decision to
 * send (and at what urgency, and on which channels) belongs to the domain that
 * knows what just happened: `auth` knows an OTP is a login credential,
 * `auth_saml` knows a welcome note is not. A channel that reaches around its own
 * dispatcher to send is the PLAT-01 shape inverted.
 *
 * Each renderer returns `null` rather than throwing: a template failure must not
 * take down the auth flow it belongs to, and every caller here is already
 * fire-and-forget.
 */
export default class MailTemplatesAuthService {

  static async renderWelcome({ email, name, tenantId }: { email: string; name?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = `Welcome to ${vars.brandName}`;
      const html = await MailService.renderTemplate('welcome.ejs', { ...vars, subject, user: { name: name || email } });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesAuthService.renderWelcome error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * The new-login alert. This one was already render-only — it was the first
   * template moved behind the dispatcher (auth-login.route), and the rest of the
   * file has now followed it.
   *
   * Returns the bare html for its existing caller; everything else in this class
   * returns `{ subject, html }`.
   */
  static async renderNewLoginEmail({
    tenantId, email, name, device, ipAddress, location, loginTime,
  }: {
    tenantId?: string; email: string; name?: string; device?: string;
    ipAddress?: string; location?: string; loginTime?: string;
  }): Promise<string> {
    const vars = await getBaseTemplateVars(tenantId);
    return MailService.renderTemplate('new_login.ejs', {
      ...vars, subject: 'New Login Detected', user: { name: name || email },
      device: device || 'Unknown', ipAddress: ipAddress || 'Unknown',
      location: location || 'Unknown', loginTime: loginTime || new Date().toLocaleString(),
    });
  }

  static async renderForgotPassword({
    email, name, resetToken, subject: subjectOverride, tenantId,
  }: { email: string; name?: string; resetToken: string; subject?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = subjectOverride || 'Reset Your Password';
      const resetLink = vars.resetPasswordLink + '?resetToken=' + resetToken + '&email=' + encodeURIComponent(email);
      const html = await MailService.renderTemplate('forgot_password.ejs', {
        ...vars, subject, user: { name: name || email }, resetToken, resetLink, expiryTime: 1,
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesAuthService.renderForgotPassword error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  static async renderPasswordResetSuccess({ email, name, tenantId }: { email: string; name?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = 'Password Reset Successful';
      const html = await MailService.renderTemplate('password_reset.ejs', { ...vars, subject, user: { name: name || email } });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesAuthService.renderPasswordResetSuccess error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  static async renderOtp({
    email, name, otpToken, subject: subjectOverride, tenantId,
  }: { email: string; name?: string | null; otpToken: string; subject?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      if (!otpToken) throw new AppError(NotificationMailMessages.OTP_TOKEN_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
      const subject = subjectOverride || 'Your OTP Code';
      const html = await MailService.renderTemplate('otp.ejs', { ...vars, subject, user: { name: name || email }, otpToken });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesAuthService.renderOtp error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  static async renderOtpEnabled({ email, name, tenantId }: { email: string; name?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = 'OTP Enabled';
      const html = await MailService.renderTemplate('otp_enabled.ejs', { ...vars, subject, user: { name: name || email } });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesAuthService.renderOtpEnabled error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  static async renderOtpDisabled({ email, name, tenantId }: { email: string; name?: string; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = 'OTP Disabled';
      const html = await MailService.renderTemplate('otp_disabled.ejs', { ...vars, subject, user: { name: name || email } });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesAuthService.renderOtpDisabled error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
