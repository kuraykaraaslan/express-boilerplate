/**
 * MCP clients of the authorization server (docs/phases/57-mcp-server D57-8, MO-5). A client is identified by its Client ID Metadata
 * Document: `client_id` is an https URL whose JSON names the client and its redirect URIs. Dynamic client registration is not offered
 * (deprecated). Which clients may connect: the platform's list of known client hosts, plus the hosts a workspace admin adds
 * (`mcpAllowedClientHosts`); anything else is refused before its document is fetched.
 *
 * The document is fetched through `safeFetch` (DNS pinned to a public address, no redirects), with a 3 s budget and an 8 KiB cap, and
 * cached in Redis for an hour by the hash of its URL. Its `client_id` must be the URL itself; every redirect URI must be https, or http
 * on a loopback address for a native app (RFC 8252 §7.3, any port), with no fragment and no credentials.
 */
import { hashToken } from './mcp_oauth.crypto';

/** The hosts of clients every workspace accepts (a host or any subdomain of it). A workspace adds its own in Settings → MCP. */
export const KNOWN_CLIENT_DOMAINS: readonly string[] = [
  'claude.ai', 'claude.com', 'anthropic.com', 'chatgpt.com', 'openai.com', 'cursor.com', 'cursor.sh', 'vscode.dev', 'visualstudio.com', 'github.com',
];

export const CIMD_MAX_BYTES = 8 * 1024;
export const CIMD_TIMEOUT_MS = 3_000;
export const CIMD_CACHE_SECONDS = 3_600;
const MAX_REDIRECT_URIS = 10;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface McpClient {
  clientId: string;
  clientName: string;
  host: string;
  redirectUris: string[];
}

export type ClientRefusal = 'invalid_client_id' | 'client_not_allowed' | 'metadata_unavailable' | 'metadata_invalid';

export class McpClientError extends Error {
  constructor(readonly reason: ClientRefusal, message: string) { super(message); }
}

/** The host of a Client ID Metadata Document URL, or null when the URL cannot be one (https, a path, no credentials, query or fragment). */
export function clientIdHost(clientId: unknown): string | null {
  if (typeof clientId !== 'string' || clientId.length > 512) return null;
  let u: URL;
  try { u = new URL(clientId); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return null;
  if (u.pathname === '/' || u.pathname === '') return null;
  const host = u.hostname.toLowerCase();
  return HOST_RE.test(host) ? host : null;
}

/** Hosts typed by an admin (one per line, comma or space separated); anything that is not a host name is ignored. */
export function parseClientHosts(value: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (value ?? '').split(/[\s,]+/)) {
    const h = raw.trim().toLowerCase().replace(/^\.+/, '');
    if (HOST_RE.test(h)) out.add(h);
    if (out.size >= 100) break;
  }
  return out;
}

export function clientHostAllowed(host: string, extra: ReadonlySet<string>): boolean {
  const match = (d: string) => host === d || host.endsWith(`.${d}`);
  return KNOWN_CLIENT_DOMAINS.some(match) || [...extra].some(match);
}

const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);

/** A redirect URI a client may register: https anywhere, or http on loopback (native apps); never a fragment or credentials. */
export function redirectUriAcceptable(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 512) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK.has(u.hostname.toLowerCase());
}

/** Validates a fetched document against the URL it came from. */
export function clientFromDocument(clientId: string, host: string, doc: unknown): McpClient {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new McpClientError('metadata_invalid', 'The client metadata is not a JSON object.');
  const d = doc as Record<string, unknown>;
  if (d.client_id !== clientId) throw new McpClientError('metadata_invalid', 'The client metadata names another client_id.');
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(redirectUriAcceptable)) {
    throw new McpClientError('metadata_invalid', 'The client metadata has no acceptable redirect_uris.');
  }
  const method = d.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') throw new McpClientError('metadata_invalid', 'Only public clients (token_endpoint_auth_method none) are supported.');
  const rawName = typeof d.client_name === 'string' ? d.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return { clientId, clientName: (rawName || host).slice(0, 100), host, redirectUris: uris as string[] };
}

export interface ClientDeps {
  fetchDocument(url: string): Promise<unknown>;
  cacheGet(key: string): Promise<string | null>;
  cacheSet(key: string, value: string, seconds: number): Promise<void>;
}

/** Reads a body as text up to `max` bytes; more is a refusal. */
async function boundedText(res: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { void reader.cancel().catch(() => undefined); throw new McpClientError('metadata_invalid', 'The client metadata is too large.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const defaultClientDeps: ClientDeps = {
  async fetchDocument(url) {
    const { safeFetch } = await import('@kuraykaraaslan-labs/common/server/safe-fetch');
    const res = await safeFetch(url, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(CIMD_TIMEOUT_MS) });
    if (res.status !== 200) throw new McpClientError('metadata_unavailable', `The client metadata answered ${res.status}.`);
    return JSON.parse(await boundedText(res as unknown as { body: ReadableStream<Uint8Array> | null }, CIMD_MAX_BYTES));
  },
  async cacheGet(key) {
    const redis = (await import('@kuraykaraaslan-labs/redis')).default;
    return redis.get(key);
  },
  async cacheSet(key, value, seconds) {
    const redis = (await import('@kuraykaraaslan-labs/redis')).default;
    await redis.set(key, value, 'EX', seconds);
  },
};

/**
 * The client of `clientId` if the workspace accepts it. The allowlist is checked first, so a refused client's document is never fetched.
 */
export async function resolveClient(clientId: unknown, extraHosts: ReadonlySet<string>, deps: ClientDeps = defaultClientDeps): Promise<McpClient> {
  const host = clientIdHost(clientId);
  if (!host) throw new McpClientError('invalid_client_id', 'client_id must be the https URL of a Client ID Metadata Document.');
  if (!clientHostAllowed(host, extraHosts)) throw new McpClientError('client_not_allowed', `Clients from ${host} may not connect to this workspace.`);
  const id = clientId as string;
  const cacheKey = `mcp:cimd:${hashToken(id)}`;
  try {
    const cached = await deps.cacheGet(cacheKey);
    if (cached) return clientFromDocument(id, host, JSON.parse(cached));
  } catch { /* fetch again */ }
  let doc: unknown;
  try {
    doc = await deps.fetchDocument(id);
  } catch (e) {
    if (e instanceof McpClientError) throw e;
    throw new McpClientError('metadata_unavailable', 'The client metadata could not be fetched.');
  }
  const client = clientFromDocument(id, host, doc);
  await deps.cacheSet(cacheKey, JSON.stringify(doc), CIMD_CACHE_SECONDS).catch(() => undefined);
  return client;
}
