import { z } from 'zod';
import { NextResponse } from 'next/server';

/** ~5 MB of bundle as base64 plus the manifest and a little JSON framing. */
export const MAX_UPLOAD_BODY_BYTES = 7_500_000;

export const UploadVersionDTO = z.object({
  scopedName: z.string().min(1).max(120).optional(),
  manifestJson: z.string().min(2).max(500_000),
  bundleBase64: z.string().min(1).max(MAX_UPLOAD_BODY_BYTES),
  bundleSha256: z.string().max(80).optional(),
  signature: z.string().min(1).max(200).optional(),
  signerKid: z.string().min(1).max(100).optional(),
}).strict();

export const VersionActionDTO = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), grant: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ action: z.literal('yank'), reason: z.string().max(500).optional() }).strict(),
]);

export const PluginStatusDTO = z.object({ status: z.enum(['active', 'disabled']) }).strict();

export const InstallActionDTO = z.object({
  // D9: one tenant, one spelling: the id is lower-cased, so the projection and its settings cache land in the namespace the
  // tenant's own (lower-case) reads use.
  tenantId: z.string().uuid().transform((v) => v.toLowerCase()),
  action: z.enum(['install', 'activate', 'deactivate', 'uninstall']),
  versionId: z.string().uuid().optional(),
}).strict();

const LimitsDTO = z.object({
  memoryMb: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  httpTimeoutMs: z.number().int().positive().optional(),
  httpMaxBytes: z.number().int().positive().optional(),
}).strict();

export const TrustPolicyDTO = z.object({
  trustedKeys: z.array(z.object({ kid: z.string().min(1).max(100), publicKey: z.string().min(1).max(2000) }).strict()).max(50).optional(),
  requireSigned: z.boolean().optional(),
  maxLimits: LimitsDTO.optional(),
}).strict();

export const SetLocalPluginConfigDTO = z.object({
  settings: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])).optional(),
  secrets: z.record(z.string(), z.string().max(8000)).optional(),
}).strict();

export { UUID_RE } from './plugin_local.types';

/** The body exceeded the byte cap while it was being read. */
export class BodyTooLargeError extends Error {}

/**
 * Read the body as text, counting bytes as they arrive: a chunked request (no `content-length`) or one that lies about
 * its length is cut off at `maxBytes` instead of being buffered whole.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(`The request body is larger than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Parse a JSON body against a schema: the data, or a 400 response naming the problems (413 when `maxBytes` is given
 * and the body is larger).
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
  opts: { maxBytes?: number } = {},
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  if (opts.maxBytes !== undefined) {
    try {
      const text = await readBodyCapped(request, opts.maxBytes);
      try { raw = JSON.parse(text); } catch { raw = undefined; }
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        return { ok: false, response: NextResponse.json({ success: false, message: 'The upload is too large (bundle max 5 MB).' }, { status: 413 }) };
      }
      throw e;
    }
  } else {
    raw = await request.json().catch(() => undefined);
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    response: NextResponse.json(
      { success: false, message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', ') },
      { status: 400 },
    ),
  };
}

export const notFoundResponse = (message = 'Not found.') => NextResponse.json({ success: false, message }, { status: 404 });
