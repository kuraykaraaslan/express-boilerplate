import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { MailAttachment } from './providers/base.provider';

/**
 * Attachments on their way through the mail queue (NX-25 follow-up, G-076).
 *
 * A queued job round-trips through Redis as JSON, and `Buffer.toJSON()` turns the
 * bytes into `{type:'Buffer',data:[…]}`, which `IsolatedMailProvider` used to
 * fail `Buffer.isBuffer` on and base64 as the string `[object Object]`: a
 * corrupt attachment reported as `success`. So the job carries each file as
 * base64 text (the same shape the sandboxed providers already take, see
 * `providers/isolated.provider.ts`) and the worker turns it back into a Buffer.
 *
 * The checks run on BOTH sides, like `sanitizeMailHeaders`: at enqueue so a bad
 * file is the caller's error, and at the worker because a job replayed from
 * Redis, or enqueued by an older build, never passed the first one.
 */

/** Files in one mail. */
export const MAX_MAIL_ATTACHMENTS = 10;

/**
 * Decoded bytes of all files in one mail. Base64 grows that by a third, so a full
 * mail is ~9.3 MiB on the wire: under the 10 MB whole-message cap of the
 * strictest providers we ship (Postmark, SES), and a bounded Redis job.
 */
export const MAX_MAIL_ATTACHMENT_BYTES = 7 * 1024 * 1024;

/** A file as it sits in a queued job: JSON-safe. */
export interface QueuedMailAttachment {
  filename: string;
  contentBase64: string;
  contentType?: string;
  cid?: string;
}

/**
 * `type/subtype`, RFC 6838 token characters (nodemailer writes it into a header, so nothing else gets through), and
 * only a top-level type that is a leaf part. `message/*` and `multipart/*` are refused: nodemailer gives them no
 * transfer encoding (7.0.12 `getTransferEncoding`; `message/rfc822` even goes `8bit` and inline), so the tenant's bytes
 * would reach SMTP DATA raw (NULs, bare CRs, lines over 998 characters) and could pose as a second, forged message.
 */
export const MAIL_CONTENT_TYPE_RE = /^(?:application|image|text|audio|video|font)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;
/** A Content-ID the HTML references as `cid:<id>`: plain characters only, so it is safe in an attribute and a header. */
export const MAIL_CID_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_FILENAME = 255;

const invalid = (message: string) => new AppError(message, 422, ErrorCode.VALIDATION_ERROR);

/**
 * The name a receiver sees: one line, no path, no control characters, and no invisible format characters (Unicode
 * `Cf`: the bidi overrides U+202A-202E and isolates U+2066-2069, the marks U+200E/U+200F, zero-width characters,
 * U+FEFF…), which are dropped so `invoice\u202Efdp.exe` cannot display as `invoiceexe.pdf`.
 */
function filenameOf(raw: unknown, index: number): string {
  const name = String(raw ?? '')
    .replace(/\p{Cf}+/gu, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/[\\/]+/g, '_')
    .trim()
    .slice(0, MAX_FILENAME);
  if (!name) throw invalid(`Mail attachment ${index + 1} has no file name`);
  return name;
}

/**
 * The attachments as they may be sent, or undefined for none. Throws a 422 for a
 * file that is malformed (no name, a content type or Content-ID that could break
 * a header, content that is not bytes or text, a repeated Content-ID) and a 413
 * when there are too many or they are too large together. Never repairs content:
 * a mail with a different file than the one asked for is worse than no mail.
 */
export function normaliseMailAttachments(list?: readonly MailAttachment[] | null): MailAttachment[] | undefined {
  if (!list || list.length === 0) return undefined;
  if (list.length > MAX_MAIL_ATTACHMENTS) {
    throw new AppError(`At most ${MAX_MAIL_ATTACHMENTS} mail attachments`, 413, ErrorCode.VALIDATION_ERROR);
  }
  const cids = new Set<string>();
  let total = 0;
  const out = list.map((a, i): MailAttachment => {
    const filename = filenameOf(a?.filename, i);
    const content = a?.content;
    if (!Buffer.isBuffer(content) && typeof content !== 'string') throw invalid(`Mail attachment ${filename} has no content`);
    const contentType = a.contentType === undefined || a.contentType === '' ? undefined : String(a.contentType);
    if (contentType !== undefined && !MAIL_CONTENT_TYPE_RE.test(contentType)) throw invalid(`Mail attachment ${filename} has an invalid content type`);
    const cid = a.cid === undefined || a.cid === '' ? undefined : String(a.cid);
    if (cid !== undefined) {
      if (!MAIL_CID_RE.test(cid)) throw invalid(`Mail attachment ${filename} has an invalid Content-ID`);
      if (cids.has(cid)) throw invalid(`Mail attachment Content-ID used twice: ${cid}`);
      cids.add(cid);
    }
    total += Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content);
    return { filename, content, ...(contentType && { contentType }), ...(cid && { cid }) };
  });
  if (total > MAX_MAIL_ATTACHMENT_BYTES) {
    throw new AppError(`Mail attachments exceed ${MAX_MAIL_ATTACHMENT_BYTES} bytes`, 413, ErrorCode.VALIDATION_ERROR);
  }
  return out;
}

/** Checked attachments as JSON-safe job data (string content is sent as its UTF-8 bytes, as the providers always did). */
export function encodeMailAttachments(list?: readonly MailAttachment[] | null): QueuedMailAttachment[] | undefined {
  return normaliseMailAttachments(list)?.map((a) => ({
    filename: a.filename,
    contentBase64: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, 'utf8')).toString('base64'),
    ...(a.contentType && { contentType: a.contentType }),
    ...(a.cid && { cid: a.cid }),
  }));
}

/** Job data back to attachments with Buffer content, checked again (a job read from Redis is untrusted input). */
export function decodeMailAttachments(list?: readonly QueuedMailAttachment[] | null): MailAttachment[] | undefined {
  if (!list || list.length === 0) return undefined;
  if (list.length > MAX_MAIL_ATTACHMENTS) {
    throw new AppError(`At most ${MAX_MAIL_ATTACHMENTS} mail attachments`, 413, ErrorCode.VALIDATION_ERROR);
  }
  // judged on the text before anything is decoded, so an oversized job never becomes a Buffer
  const encoded = list.reduce((n, q) => n + (typeof q?.contentBase64 === 'string' ? q.contentBase64.length : 0), 0);
  if (Math.floor(encoded / 4) * 3 > MAX_MAIL_ATTACHMENT_BYTES + 2 * list.length) {
    throw new AppError(`Mail attachments exceed ${MAX_MAIL_ATTACHMENT_BYTES} bytes`, 413, ErrorCode.VALIDATION_ERROR);
  }
  return normaliseMailAttachments(list.map((q, i) => {
    const b64 = q?.contentBase64;
    if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
      throw invalid(`Mail attachment ${i + 1} is not valid base64`);
    }
    return { filename: q.filename, content: Buffer.from(b64, 'base64'), contentType: q.contentType, cid: q.cid };
  }));
}
