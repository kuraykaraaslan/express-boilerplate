export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: MailAttachment[];
  /**
   * Extra RFC 5322 headers, name → value.
   *
   * This is the field that makes threading possible: `Message-ID`, `References`
   * and `In-Reply-To` are the only durable link between a mail we sent and the
   * reply that comes back, and `List-Unsubscribe` / `Auto-Submitted` / `X-Loop`
   * have no other home either. Everything above is a well-known field with a
   * dedicated slot; this is the escape hatch for the rest.
   *
   * **Sanitised before it reaches a provider** — see `sanitizeMailHeaders` in
   * `notification_mail.queue.service.ts`. A caller cannot smuggle a `Bcc` in
   * here, nor a CRLF that would split the header block.
   *
   * Not every provider can carry these. Amazon SES's `SendEmail` action has no
   * parameter for a custom header, so the SES plugin drops them silently. That
   * is a real capability difference, not a bug to paper over.
   */
  headers?: Record<string, string>;
}

export interface MailAttachment {
  filename: string;
  /** Bytes, or text sent as its UTF-8 bytes. */
  content: string | Buffer;
  contentType?: string;
  /**
   * Content-ID of an inline image: the HTML shows it with `<img src="cid:<cid>">`.
   * Checked by `normaliseMailAttachments` (plain characters, unique per mail).
   * A provider that cannot send inline parts sends the file as an ordinary
   * attachment, which is the same degradation a mail client without inline
   * support shows.
   */
  cid?: string;
}

export interface MailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Tenant-aware mail provider contract.
 *
 * Every method takes the resolved `tenantId` as its first argument so each
 * tenant can store its own SMTP / SES / Mailgun / Postmark / Resend / SendGrid
 * credentials in its `settings` table. Providers fall back to `env.*` when a
 * tenant has not configured the matching key.
 */
export default abstract class BaseMailProvider {
  abstract readonly name: string;

  /** Send a mail using credentials resolved for the given tenant. */
  abstract sendMail(tenantId: string, options: MailOptions): Promise<MailResult>;

  /**
   * Whether the provider has the minimum credentials it needs for the given
   * tenant. Implementations consult SettingService(tenantId) first, then
   * `env.*` as a fallback.
   */
  abstract isConfigured(tenantId: string): Promise<boolean>;
}
