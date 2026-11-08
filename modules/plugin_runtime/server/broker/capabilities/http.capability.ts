// http: SSRF-guarded, allowlisted egress with host-side signed-secret injection.
import { assertSafeWebhookUrl } from '@kuraykaraaslan-labs/webhook/server/webhook.ssrf';
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch';
import type { Json } from '../../../sdk/types';
import { substituteSecrets, resolveSecret, type BrokerCtx } from '../broker.context';

type BodyResponse = { headers: Headers; body?: ReadableStream<Uint8Array> | null; arrayBuffer(): Promise<ArrayBuffer> };

/**
 * The response body, never more than `max` bytes in memory (common.05, plugin_runtime.05): a declared Content-Length above
 * the cap is refused before a byte is read, and a streamed body is read chunk by chunk and cancelled as soon as it passes
 * the cap. A response without a stream (a test double) falls back to the whole buffer, still checked against the cap.
 */
export async function readCappedBody(res: BodyResponse, max: number): Promise<Buffer> {
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) throw new Error('response too large');
  const stream = res.body;
  if (!stream || typeof stream.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > max) throw new Error('response too large');
    return buf;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), total);
}

export const http = {
  async fetch(
    ctx: BrokerCtx,
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; bodyBase64?: string; timeoutMs?: number; basic?: { username: string; secretName: string } },
  ): Promise<Json> {
    // Substitute {{secret:NAME}} in the URL too (e.g. WeChat's query-string client
    // secret), then re-validate the FINAL host — the allowlist + SSRF checks run on
    // the substituted URL, so a secret can never redirect egress off the allowlist.
    const substitutedUrl = await substituteSecrets(ctx, String(url));
    let parsed: URL;
    try { parsed = new URL(substitutedUrl); } catch { throw new Error('invalid url'); }
    // https only: a {{secret:…}} placeholder is filled in host-side, and plain http would carry it in cleartext.
    if (parsed.protocol !== 'https:') throw new Error('only https allowed');
    if (!ctx.httpAllowlist.includes(parsed.host)) {
      // Never echo a host a secret was substituted into: the refusal reaches the isolate.
      throw new Error(substitutedUrl === String(url) ? `host not in allowlist: ${parsed.host}` : 'host not in allowlist');
    }
    await assertSafeWebhookUrl(parsed.toString()); // DNS-rebinding-safe SSRF check
    const controller = new AbortController();
    const timeout = Math.min(init?.timeoutMs ?? ctx.limits.httpTimeoutMs, ctx.limits.httpTimeoutMs);
    const t = setTimeout(() => controller.abort(), timeout);
    try {
      // Inject any {{secret:NAME}} placeholders host-side (signed egress).
      const reqHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(init?.headers ?? {})) reqHeaders[k] = await substituteSecrets(ctx, String(v));
      // Basic auth built host-side so the secret is base64'd correctly (the isolate
      // can't base64 a {{secret:…}} placeholder). Used by e.g. Twitter's token endpoint.
      if (init?.basic) {
        const cred = `${init.basic.username}:${await resolveSecret(ctx, init.basic.secretName)}`;
        reqHeaders['authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`;
      }
      // bodyBase64: raw binary request body (e.g. an S3 PutObject upload) the isolate
      // can't carry as a string — decoded host-side, no secret substitution.
      const reqBody = init?.bodyBase64 != null
        ? Buffer.from(String(init.bodyBase64), 'base64')
        : (init?.body != null ? await substituteSecrets(ctx, String(init.body)) : undefined);
      // safeFetch pins the validated IP for the connection (no DNS-rebinding
      // window); the host allowlist above still restricts WHICH hosts are reachable.
      const res = await safeFetch(parsed.toString(), {
        method: init?.method ?? 'GET',
        headers: reqHeaders,
        body: reqBody as never,
        signal: controller.signal,
        redirect: 'manual', // do not silently follow redirects past the allowlist
      });
      const buf = await readCappedBody(res as unknown as BodyResponse, ctx.limits.httpMaxBytes);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      return { status: res.status, headers: resHeaders, body: buf.toString('utf8') } as Json;
    } finally {
      clearTimeout(t);
    }
  },
};
