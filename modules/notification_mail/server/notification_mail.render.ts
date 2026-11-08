import ejs from 'ejs';
import path from 'path';
import { noticeFor, type MailTemplateVars } from './notification_mail.brand';

/**
 * Render a body template inside the shared header / footer / layout.
 *
 * Kept free of env, queue and Redis imports so it can be exercised directly
 * (snapshot tests) and so `NotificationMailProviderService.renderTemplate` stays
 * a one-line delegate.
 *
 * `securityNotice` is computed HERE, from the template's name and the brand
 * flags in `data`, and always overwrites whatever the caller passed: the
 * sentence for a branded-but-unverified tenant must not be something a caller
 * (or a tenant value that reached `data`) can supply, blank or reword.
 */
export async function renderMailTemplate(
  templateDir: string,
  templateName: string,
  data: Record<string, unknown>,
): Promise<string> {
  const full = { ...data, securityNotice: noticeFor(templateName, data as Partial<MailTemplateVars>) };
  const body = await ejs.renderFile(path.join(templateDir, templateName), full, { async: true });
  const headerHtml = await ejs.renderFile(path.join(templateDir, 'partials', 'email_header.ejs'), full, { async: true });
  const footerHtml = await ejs.renderFile(path.join(templateDir, 'partials', 'email_footer.ejs'), full, { async: true });
  return ejs.renderFile(path.join(templateDir, 'layouts', 'email_layout.ejs'), { ...full, body, headerHtml, footerHtml }, { async: true });
}
