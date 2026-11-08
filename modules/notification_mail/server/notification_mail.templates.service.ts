import MailTemplatesInvoiceService from './notification_mail.templates.invoice.service';
import MailTemplatesAuthService from './notification_mail.templates.auth.service';

export { MailTemplatesInvoiceService, MailTemplatesAuthService };

export default class MailTemplatesService {

  // Invoice templates — RENDER ONLY (PLAT-01), like the auth half below.
  static renderInvoiceIssued           = MailTemplatesInvoiceService.renderInvoiceIssued.bind(MailTemplatesInvoiceService);
  static renderInvoicePaid             = MailTemplatesInvoiceService.renderInvoicePaid.bind(MailTemplatesInvoiceService);
  static renderInvoicePaymentFailed    = MailTemplatesInvoiceService.renderInvoicePaymentFailed.bind(MailTemplatesInvoiceService);

  // Auth / OTP templates — RENDER ONLY (PLAT-01): the owning domain decides to
  // send, because it is the one that knows an OTP is a login credential and a
  // welcome note is not.
  static renderWelcome                 = MailTemplatesAuthService.renderWelcome.bind(MailTemplatesAuthService);
  static renderNewLoginEmail           = MailTemplatesAuthService.renderNewLoginEmail.bind(MailTemplatesAuthService);
  static renderForgotPassword          = MailTemplatesAuthService.renderForgotPassword.bind(MailTemplatesAuthService);
  static renderPasswordResetSuccess    = MailTemplatesAuthService.renderPasswordResetSuccess.bind(MailTemplatesAuthService);
  static renderOtp                     = MailTemplatesAuthService.renderOtp.bind(MailTemplatesAuthService);
  static renderOtpEnabled              = MailTemplatesAuthService.renderOtpEnabled.bind(MailTemplatesAuthService);
  static renderOtpDisabled             = MailTemplatesAuthService.renderOtpDisabled.bind(MailTemplatesAuthService);
}
