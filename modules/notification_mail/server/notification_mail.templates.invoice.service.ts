import Logger from '@kuraykaraaslan-labs/logger';
import MailService from './notification_mail.service';
import { getBaseTemplateVars } from './notification_mail.template-vars';
import type { RenderedMail } from './notification_mail.account-templates.service';

/**
 * Invoice / dunning email BODIES. Rendering only — nothing here queues a message
 * (PLAT-01): `invoice` and `tenant_subscription` own the decision to send, and
 * this module is a channel behind the dispatcher.
 *
 * `null` on failure rather than a throw: every caller is best-effort, because an
 * invoice is issued whether or not its email went out.
 */
export default class MailTemplatesInvoiceService {

  static async renderInvoiceIssued({
    invoice, tenantId,
  }: { invoice: Record<string, unknown>; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = `Invoice ${invoice.invoiceNumber} — ${invoice.totalAmount} ${invoice.currency}`;
      const html = await MailService.renderTemplate('invoice_issued.ejs', { ...vars, subject, invoice });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesInvoiceService.renderInvoiceIssued error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  static async renderInvoicePaid({
    invoice, tenantId,
  }: { invoice: Record<string, unknown>; tenantId?: string }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = `Receipt for ${invoice.invoiceNumber} — paid`;
      const html = await MailService.renderTemplate('invoice_paid.ejs', { ...vars, subject, invoice });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesInvoiceService.renderInvoicePaid error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  static async renderInvoicePaymentFailed({
    invoice, reason, retryAt, billingPortalUrl, tenantId,
  }: {
    invoice: Record<string, unknown>; tenantId?: string;
    reason?: string; retryAt?: Date | string; billingPortalUrl?: string;
  }): Promise<RenderedMail | null> {
    try {
      const vars = await getBaseTemplateVars(tenantId);
      const subject = `Payment failed — invoice ${invoice.invoiceNumber}`;
      const html = await MailService.renderTemplate('invoice_payment_failed.ejs', {
        ...vars, subject, invoice, reason, retryAt, billingPortalUrl: billingPortalUrl ?? '',
      });
      return { subject, html };
    } catch (error: unknown) {
      Logger.error(`MailTemplatesInvoiceService.renderInvoicePaymentFailed error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
