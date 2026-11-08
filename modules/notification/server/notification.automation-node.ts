import { createHash } from 'node:crypto';
import type { NodeContribution, NodeContext } from '@kuraykaraaslan-labs/automation_integrations';
import NotificationService from './notification.service';
import { tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { listChannelDescriptors } from './notification.channels';
import { notificationHtmlToText, sanitizeNotificationHtml } from './notification.html';
import { CUSTOM_ROLE_KEY, defaultCustomRoleMembers, defaultRoleMembers, defaultTeamMembers, ROLES, type RoleMembers, type TeamMembers } from './notification.automation-members';
import {
  MAX_NOTIFICATION_ATTACHMENTS, NOTIFICATION_CHANNEL_PATTERN, NotificationAttachmentSchema,
  type NotificationAttachment, type NotificationRecipient, type SpentQuota,
} from './notification.types';

/**
 * `automation:node` contribution: `action.notify` (docs/phases/08-automation/05-generic-node-catalog/04 §5.20, router-shared
 * name). The executor calls `NotificationService.notify` and never a channel module (PLAT-01). Imports `automation` with
 * `import type` only (02 §2.8), so this file runs with the engine absent; the registry only loads it when `automation` is on.
 *
 * Recipients by user, address, phone, `role` and `originator_owner` (the owners of the message's originator entity, from the
 * choices list that declares that entity type: none known means none added), and `role` (the ACTIVE members of OWNER, ADMIN or USER, read through `tenant_member`; a role
 * with more than the recipient cap is refused, a failed lookup fails closed); `channels`, `urgency`, `title`, `text`, `subject`,
 * `reply_to`, `cc`, `bcc` and `attachments` (files and inline images from the message, G-076: `NotificationEvent.attachments`,
 * which the mail channel sends and the others ignore). A channel whose monthly quota is spent (or which the plan does not
 * grant) is dropped from the send and named in `metadata.notify.quota`; only when every channel the call would use is
 * spent is it answered `limit` with `{ key: 'feature_email_monthly_quota' | 'feature_sms_monthly_quota', scope: 'plan' }`
 * before anything is sent (G-137: `NotificationService.spentQuotas`, read-only). `format: html` (G-072): the text is rendered
 * with every substituted value HTML-escaped, sanitised against a strict allowlist (`notification.html`) and sent as
 * `data.html`, which only the mail channel reads; `body` is its plain-text form, for every other channel. The choice lists are
 * in `notification.automation-choices` (`notification.channels`, `notification.recipients`).
 *
 * Flow protection (08/14 FP-17, LG-21), through the engine's `ctx.notifyGate`: a late message (a device reading the host ran after
 * its time-to-live, `metadata.late`) notifies nobody, and a recipient this flow told the same reason inside the tenant's cooldown
 * (default 10 min) is held back and counted, so an alarm storm sends one mail or SMS per person. The reason is the node's `reason`
 * when it has one, else the notification's words (title, subject and text as rendered): the same alarm repeated folds, another lead
 * or another device named in the text does not. The next notification that goes out to that person says how many were held back
 * (`(+n)` after the text, `data.held`). Nobody left to tell is not an error: the message goes on with `metadata.notify.held`.
 */
export const MAX_RECIPIENTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@,;<>()"]{1,64}@[^\s@,;<>()"]{1,255}\.[^\s@,;<>()"]{2,63}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
/** The palette category of the node (not a notification category: the push-categories guard scans `category: '<x>'` literals). */
const PALETTE_CATEGORY = 'action';
/**
 * Decoded bytes of all files of one call. A message is at most 256 KiB, so this only bounds a value read from the
 * flow or global context; the mail channel's own cap (7 MiB) is far above it.
 */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
/** The rendered html text the sanitiser takes at most (the engine's template output cap, `MAX_STR`). */
export const MAX_HTML_CHARS = 65_536;
/**
 * The content type of a file whose row leaves it empty, from the file name's extension. Several mail providers send
 * an untyped file as `application/octet-stream`, and a mail client does not show such a part as an inline image.
 * Unknown extensions stay untyped (the provider's default).
 */
const TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json', xml: 'application/xml',
  zip: 'application/zip',
};
export const contentTypeOf = (filename: string): string | undefined =>
  TYPE_BY_EXTENSION[/\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase() ?? ''];

/** The host's owner lookup (`HostApi.owners`): the user ids that own an entity, or undefined when no list knows the entity type. */
type HostOwners = { owners?(tenantId: string, entityType: string, id: string): Promise<string[] | undefined> };

interface Row { kind?: string; value?: string }
interface AttachmentRow { filename?: string; content?: unknown; encoding?: string; content_type?: string; inline_id?: string }
interface Params {
  recipients?: Row[];
  reason?: string;
  channels?: string[];
  urgency?: string;
  title?: string;
  text?: string;
  format?: string;
  subject?: string;
  reply_to?: string;
  cc?: string;
  bcc?: string;
  attachments?: AttachmentRow[];
}

export interface Resolved {
  recipients: NotificationRecipient[];
  /** Entries that were not a valid user id, e-mail address or number: counted, never sent to. */
  invalid: number;
}

/** The reasons a channel is held back by a choice of the recipient or of the address (not "not requested", "no address" or the tenant's switch). */
const SUPPRESSED_BY: ReadonlySet<string> = new Set(['channel_off', 'category_opt_out', 'quiet_hours', 'address_suppressed']);

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const split = (s: string): string[] => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

/** Rows and the cc / bcc templates to recipients, deduplicated, in order. Pure over the rendered texts. */
export function resolveRecipients(rows: ReadonlyArray<{ kind: string; text: string }>): Resolved {
  const out: NotificationRecipient[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  const add = (key: string, r: NotificationRecipient) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const { kind, text } of rows) {
    for (const item of kind === 'user' ? (text.trim() ? [text.trim()] : []) : split(text)) {
      if (kind === 'user' && UUID.test(item)) add(`u:${item.toLowerCase()}`, { userId: item.toLowerCase() });
      else if (kind === 'address' && EMAIL.test(item)) add(`e:${item.toLowerCase()}`, { email: item });
      else if (kind === 'phone' && E164.test(item)) add(`p:${item}`, { phone: item });
      else invalid++;
    }
  }
  return { recipients: out, invalid };
}

/**
 * The attachment rows as `NotificationEvent.attachments`, or the reason they cannot be sent. Never repairs a file: a
 * mail with a different file than the flow asked for is worse than none, so a bad row stops the whole call.
 * `base64` content is base64 text (how a message carries bytes, DD-8); `text` content is sent as its UTF-8 bytes
 * (an object as JSON). A row with an `inline_id` is an inline image the body can show as `cid:<id>`.
 */
export function resolveAttachments(
  rows: readonly AttachmentRow[],
  read: (row: AttachmentRow, field: 'filename' | 'content') => unknown,
): { attachments: NotificationAttachment[]; bytes: number } | { error: string } {
  if (rows.length > MAX_NOTIFICATION_ATTACHMENTS) return { error: `more than ${MAX_NOTIFICATION_ATTACHMENTS} attachments` };
  const attachments: NotificationAttachment[] = [];
  const cids = new Set<string>();
  let bytes = 0;
  for (const [i, row] of rows.entries()) {
    const filename = String(read(row, 'filename') ?? '').trim();
    const raw = read(row, 'content');
    let contentBase64: string;
    if ((row.encoding ?? 'base64') === 'text') {
      const text = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
      contentBase64 = Buffer.from(text, 'utf8').toString('base64');
    } else {
      contentBase64 = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
      if (!contentBase64) return { error: `attachment ${i + 1}: the content is not base64 text` };
    }
    // decoded size: three bytes per four characters, less the `=` padding
    bytes += Math.floor((contentBase64.length * 3) / 4) - (contentBase64.match(/=+$/)?.[0].length ?? 0);
    if (bytes > MAX_ATTACHMENT_BYTES) return { error: `the attachments are larger than ${MAX_ATTACHMENT_BYTES} bytes` };
    const cid = String(row.inline_id ?? '').trim() || undefined;
    const contentType = String(row.content_type ?? '').trim() || contentTypeOf(filename);
    const parsed = NotificationAttachmentSchema.safeParse({ filename, contentBase64, ...(contentType && { contentType }), ...(cid && { cid }) });
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'content');
      return { error: `attachment ${i + 1}: invalid ${field === 'contentBase64' ? 'base64 content' : field}` };
    }
    if (cid && cids.has(cid)) return { error: `attachment ${i + 1}: inline id ${cid} is used twice` };
    if (cid) cids.add(cid);
    attachments.push(parsed.data);
  }
  return { attachments, bytes };
}

const CHANNEL_NAME: Record<string, string> = { mail: 'mail', sms: 'SMS' };

/** A recipient as the cooldown (08/14 FP-17) keys it: the user, the address (lower case) or the number. */
export function cooldownRecipientOf(r: NotificationRecipient): string {
  return r.userId ? `u:${r.userId.toLowerCase()}` : r.email ? `e:${r.email.toLowerCase()}` : `p:${r.phone ?? ''}`;
}

/** The cooldown reason of a call: the node's own reason, else a hash of the notification's words (the same words fold). */
export function cooldownReasonOf(reason: string, words: readonly string[]): string {
  return reason ? `reason:${reason}` : `words:${createHash('sha256').update(JSON.stringify(words)).digest('hex').slice(0, 32)}`;
}

/** The `limit` message: a spent quota and a plan without the channel read differently (the fix differs: wait or upgrade). */
export function refusalText(spent: readonly SpentQuota[]): string {
  const names = (reason: SpentQuota['reason']) => spent.filter((s) => s.reason === reason).map((s) => CHANNEL_NAME[s.channel] ?? s.channel);
  const used = names('spent');
  const none = names('no_access');
  return [
    ...(used.length ? [`the monthly ${used.join(' and ')} quota ${used.length > 1 ? 'are' : 'is'} spent`] : []),
    ...(none.length ? [`the plan has no ${none.join(' or ')} access`] : []),
  ].join('; ');
}

/** Swapped by tests; the real lookup reads the tenant's members. */
let roleMembers: RoleMembers = defaultRoleMembers;
export const setRoleMembers = (fn: RoleMembers | null): void => {
  roleMembers = fn ?? defaultRoleMembers;
};
let customRoleMembers: RoleMembers = defaultCustomRoleMembers;
export const setCustomRoleMembers = (fn: RoleMembers | null): void => {
  customRoleMembers = fn ?? defaultCustomRoleMembers;
};
let teamMembers: TeamMembers = defaultTeamMembers;
export const setTeamMembers = (fn: TeamMembers | null): void => {
  teamMembers = fn ?? defaultTeamMembers;
};

const executor = async (ctx: NodeContext, msg: Parameters<NonNullable<NodeContribution['executor']['input']>>[1]) => {
  const p = ctx.node.params as Params;
  const rows: Array<{ kind: string; text: string }> = [];
  for (const [i, row] of (Array.isArray(p.recipients) ? p.recipients : []).entries()) {
    if (row?.kind === 'originator_owner') {
      // whoever owns the entity the message is about (a device, a lead): the list that knows the entity type answers
      const owners = await (ctx.host as HostOwners).owners?.(ctx.tenantId, String(msg.originator?.type ?? ''), String(msg.originator?.id ?? ''));
      if ((owners?.length ?? 0) > MAX_RECIPIENTS) return ctx.error(msg, 'too_many_recipients', `more than ${MAX_RECIPIENTS} recipients`);
      for (const id of owners ?? []) rows.push({ kind: 'user', text: id });
      continue;
    }
    if (!row || typeof row.value !== 'string' || !['user', 'address', 'phone', 'role', 'custom_role', 'team'].includes(String(row.kind))) continue;
    const text = ctx.templateOf(row.value, msg);
    if (row.kind === 'role') {
      const role = text.trim().toUpperCase();
      if (!(ROLES as readonly string[]).includes(role)) {
        rows.push({ kind: 'role', text }); // counted as invalid by resolveRecipients
        continue;
      }
      const ids = await roleMembers(ctx.tenantId, role, MAX_RECIPIENTS);
      if (ids === null) return ctx.error(msg, 'members_unavailable', 'the members of the role could not be read');
      if (ids.length > MAX_RECIPIENTS) return ctx.error(msg, 'too_many_recipients', `more than ${MAX_RECIPIENTS} recipients`);
      for (const id of ids) rows.push({ kind: 'user', text: id });
      continue;
    }
    if (row.kind === 'custom_role' || row.kind === 'team') {
      const key = text.trim();
      const valid = row.kind === 'team' ? UUID.test(key) : CUSTOM_ROLE_KEY.test(key);
      if (!valid) {
        rows.push({ kind: 'role', text }); // counted as invalid by resolveRecipients
        continue;
      }
      const ids = await (row.kind === 'team' ? teamMembers : customRoleMembers)(ctx.tenantId, key, MAX_RECIPIENTS);
      if (ids === null) return ctx.error(msg, 'members_unavailable', `the members of the ${row.kind === 'team' ? 'team' : 'role'} could not be read`);
      if (ids.length > MAX_RECIPIENTS) return ctx.error(msg, 'too_many_recipients', `more than ${MAX_RECIPIENTS} recipients`);
      for (const id of ids) rows.push({ kind: 'user', text: id });
      continue;
    }
    rows.push({ kind: row.kind as string, text });
    if (i >= MAX_RECIPIENTS * 4) break; // a runaway row list never reaches the renderer
  }
  for (const [param, kind] of [['cc', 'address'], ['bcc', 'address']] as const) {
    if (typeof p[param] === 'string' && p[param]) rows.push({ kind, text: ctx.template(param, msg) });
  }
  const resolved = resolveRecipients(rows);
  const { recipients } = resolved;
  let invalid = resolved.invalid;
  if (recipients.length > MAX_RECIPIENTS) return ctx.error(msg, 'too_many_recipients', `more than ${MAX_RECIPIENTS} recipients`);
  if (recipients.length === 0) return ctx.error(msg, 'no_recipients', invalid ? 'none of the recipients is valid' : 'no recipients');

  const channels = (Array.isArray(p.channels) ? p.channels : []).filter((c): c is string => typeof c === 'string' && NOTIFICATION_CHANNEL_PATTERN.test(c));
  const title = p.title ? ctx.template('title', msg) : '';
  const subject = p.subject ? ctx.template('subject', msg) : title;
  // one address: the mail channel takes the first valid one, so an invalid entry is counted here and the mail goes out without a Reply-To
  const replyCandidate = p.reply_to ? split(ctx.template('reply_to', msg))[0] : undefined;
  const replyTo = replyCandidate && EMAIL.test(replyCandidate) ? replyCandidate : undefined;
  if (replyCandidate && !replyTo) invalid++;
  const urgency = p.urgency === 'critical' ? 'CRITICAL' : 'NORMAL';
  const files = resolveAttachments(
    Array.isArray(p.attachments) ? p.attachments.filter((r) => r && typeof r === 'object') : [],
    (row, field) => (field === 'filename' ? ctx.templateOf(String(row.filename ?? ''), msg) : ctx.valueOf(row.content, msg)),
  );
  if ('error' in files) return ctx.error(msg, 'invalid_attachment', files.error);
  const { attachments } = files;
  // G-072: with `html`, a value the template substitutes is escaped (message data never becomes markup) and the author's own
  // markup is cut down to the allowlist; images may name only this call's inline files (`cid:`) or https
  let body = '';
  let html = '';
  if (p.text && p.format === 'html') {
    // the engine already stops the render at 64 KiB (`templateOf`, one step budget); checked here again so the sanitiser
    // never parses more than that whatever runtime rendered it
    const rendered = ctx.templateOf(p.text, msg, escapeHtml);
    if (rendered.length > MAX_HTML_CHARS) return ctx.error(msg, 'limit', `the html text is longer than ${MAX_HTML_CHARS} characters`);
    html = sanitizeNotificationHtml(rendered, attachments.flatMap((a) => (a.cid ? [a.cid] : [])));
    body = notificationHtmlToText(html);
  } else if (p.text) {
    body = ctx.template('text', msg);
  }

  if (ctx.dryRun) {
    // 08 §8.11: nothing is sent; the count and the channels, never an address, the text or a file
    ctx.would(`notify ${recipients.length} recipient(s)`, {
      recipients: recipients.length, invalid, channels, urgency, ...(attachments.length && { attachments: attachments.length, bytes: files.bytes }),
    });
    return ctx.send(msg);
  }

  // G-137: a spent monthly mail or SMS quota is enforced later, in the channel's queue, where this node never sees it; so
  // the channels the call would use are asked first, read-only: the channels it names, or with none named every channel
  // when a recipient is a user (whose preferences pick), else the address channels of its recipients. One channel without
  // room never blocks the others: it is dropped from the send and reported in `metadata.notify.quota`; only when every
  // channel the call would use has no room is the call refused `limit`.
  // A redelivery is not refused for a quota spent since: a channel on which a send of this call already completed stays in
  // (`replay`), and the channel answers each completed send from its record before its own quota gate.
  const would = channels.length ? channels
    : recipients.some((r) => r.userId) ? [...(await listChannelDescriptors(tenantCtx(ctx.tenantId))).keys()]
    : [...(recipients.some((r) => r.email) ? ['mail'] : []), ...(recipients.some((r) => r.phone) ? ['sms'] : [])];
  const idempotencyKey = ctx.idempotencyKey(msg);
  const spent = await NotificationService.spentQuotas(ctx.tenantId, would, { idempotencyKey, recipients });
  const spentChannels = new Set(spent.map((s) => s.channel as string));
  const sendChannels = spent.length ? would.filter((c) => !spentChannels.has(c)) : channels;
  if (spent.length && sendChannels.length === 0) {
    return ctx.error(msg, 'limit', refusalText(spent), { limit: { key: spent[0].key, scope: 'plan' }, notify: { quota: [...spentChannels] } });
  }

  // 08/14 FP-17, LG-21: nobody is told of a late message, and a person this flow told the same within the cooldown is held back;
  // after the quota read (read-only), so a call refused for a spent quota claims no cooldown
  const gate = await ctx.notifyGate(msg, cooldownReasonOf(p.reason ? ctx.template('reason', msg).trim() : '', [title, subject, body, html]), recipients.map(cooldownRecipientOf));
  const sendSet = new Set(gate.send);
  const sendTo = recipients.filter((r) => sendSet.has(cooldownRecipientOf(r)));
  if (!sendTo.length) {
    ctx.action(gate.late ? 'notify skipped: the message is late' : `notify held back for ${recipients.length} recipient(s): told the same within the cooldown`);
    const out = ctx.clone(msg);
    out.metadata = { ...out.metadata, notify: { recipients: recipients.length, delivered: 0, failed: 0, suppressed: 0, invalid, held: gate.held.length, ...(gate.late && { late: true }) } };
    return ctx.send(out);
  }
  // the held-back count since the last one this person got rides on the one that goes out now
  if (gate.heldBefore > 0) {
    body = body ? `${body}\n\n(+${gate.heldBefore})` : `(+${gate.heldBefore})`;
    if (html) html = `${html}<p>(+${gate.heldBefore})</p>`;
  }

  // one call for the whole list: the dispatcher adds each recipient to a channel's idempotency key, so one key serves all of them
  let results: Awaited<ReturnType<typeof NotificationService.notify>>;
  try {
    results = await NotificationService.notify(
      ctx.tenantId, sendTo,
      {
        event: 'automation.notify', category: 'automation', ...(title && { title }), ...(body && { body }),
        data: {
          flowId: ctx.flow.id, nodeId: ctx.node.id, ...(typeof msg._run === 'string' && { runId: msg._run }),
          ...(subject && { subject }), ...(replyTo && { replyTo }), ...(html && { html }), ...(gate.heldBefore > 0 && { held: gate.heldBefore }),
        },
        // beside `data`, never in it: the in-app and push channels copy `data` into their rows and payloads
        ...(attachments.length && { attachments }),
      },
      { ...(sendChannels.length && { channels: sendChannels }), urgency, idempotencyKey },
    );
  } catch (e) {
    // 08/14 FP-17: nobody was told, so nobody's cooldown is used up (the retry, or the next alarm, goes out)
    await gate.release(gate.send);
    throw e;
  }
  let delivered = 0;
  let failed = 0;
  let suppressed = 0;
  const untold: string[] = [];
  results.forEach((res, i) => {
    delivered += res.delivered.length;
    failed += res.failed.length;
    suppressed += (res.decision?.decisions ?? []).filter((d) => !d.allowed && d.reason !== null && SUPPRESSED_BY.has(d.reason)).length;
    // a person no channel reached (every one failed, was suppressed or is not installed) was not told: their claim goes back
    if (res.delivered.length === 0 && sendTo[i]) untold.push(cooldownRecipientOf(sendTo[i]));
  });
  if (untold.length) await gate.release(untold);
  const notify = { recipients: recipients.length, delivered, failed, suppressed, invalid, ...(gate.held.length && { held: gate.held.length }), ...(spent.length && { quota: [...spentChannels] }) };
  // every delivery that was tried failed: the flow must see it (a partial failure is counted on `out`)
  if (delivered === 0 && failed > 0) return ctx.error(msg, 'notify_failed', 'every delivery failed', { notify });
  ctx.action(`notify ${sendTo.length} recipient(s)${gate.held.length ? `, ${gate.held.length} held back` : ''}`);
  const out = ctx.clone(msg);
  out.metadata = { ...out.metadata, notify };
  ctx.send(out);
};

const contribution: NodeContribution = {
  type: 'action.notify',
  declaration: {
    type: 'action.notify',
    title: 'Notify',
    description: 'Sends a notification to users, e-mail addresses or phone numbers through their channels',
    sample: { msg: { payload: { text: 'Pump 1 is offline' }, topic: 'alerts/pump' } },
    category: PALETTE_CATEGORY,
    group: 'network',
    inputs: 1,
    outputs: ['out'],
    risk: 'external',
    runtimes: ['cloud'],
    features: ['notification'],
    params: {
      recipients: {
        type: 'rules', label: 'Recipients', required: true, max: MAX_RECIPIENTS,
        items: {
          kind: { type: 'enum', options: ['user', 'address', 'phone', 'role', 'custom_role', 'team', 'originator_owner'], default: 'user', label: 'Kind' },
          value: { type: 'template', max_len: 500, label: 'User id, address, number, role (OWNER, ADMIN, USER), custom role key or team id; empty for the originator’s owners' },
        },
      },
      reason: {
        type: 'template', max_len: 200, label: 'Repeat reason',
        hint: 'one notification per person and reason in the cooldown (10 min unless the plan says otherwise), the rest are counted; empty = the words of the notification',
      },
      channels: { type: 'source', source: 'notification.channels', multiple: true, free: true, label: 'Channels', hint: 'empty = each recipient’s preferences' },
      urgency: { type: 'enum', options: ['normal', 'critical'], default: 'normal', label: 'Urgency' },
      title: { type: 'template', max_len: 200, label: 'Title' },
      text: { type: 'template', max_len: 4000, label: 'Text' },
      format: { type: 'enum', options: ['text', 'html'], default: 'text', label: 'Text format', hint: 'html: the mail gets the sanitised HTML, the other channels its plain text' },
      subject: { type: 'template', max_len: 200, label: 'Mail subject', hint: 'default: the title' },
      reply_to: { type: 'template', max_len: 320, label: 'Reply to' },
      cc: { type: 'template', max_len: 1000, label: 'Copy (each gets their own mail)' },
      bcc: { type: 'template', max_len: 1000, label: 'Hidden copy (each gets their own mail)' },
      attachments: {
        type: 'rules', label: 'Mail attachments', max: MAX_NOTIFICATION_ATTACHMENTS,
        items: {
          filename: { type: 'template', max_len: 255, label: 'File name' },
          content: { type: 'value', label: 'Content', hint: 'e.g. msg.payload.file' },
          encoding: { type: 'enum', options: ['base64', 'text'], default: 'base64', label: 'Content is' },
          content_type: { type: 'string', max_len: 127, label: 'Content type', hint: 'e.g. image/png; empty = from the file extension (png, jpg, gif, webp, pdf, csv, txt, json, xml, zip)' },
          inline_id: { type: 'string', max_len: 128, label: 'Inline image id', hint: 'set to show the image in the mail (cid:<id>)' },
        },
      },
    },
  },
  executor: { input: executor, dryRunAware: true },
  external: true,
  // 08/14 LG-21: runs to `ctx.notifyGate`, which tells nobody of a late message (counted `ttl`) and passes it on
  late: 'run',
  parallel: true,
  timeout: { class: 'external', default: 10_000, max: 30_000 },
};

const notificationNodes: NodeContribution[] = [contribution];
export default notificationNodes;