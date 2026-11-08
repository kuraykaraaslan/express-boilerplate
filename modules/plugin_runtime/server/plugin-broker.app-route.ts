// Next.js route of this module, served at /internal/api/plugin-broker (declared in module.json `appRoutes`; the file Next reads is generated into app/(modules)/).
// Internal capability broker endpoint — the creds-holding side of the plugin
// runtime. ONLY the plugin-host (token-authenticated) calls this; it must be exposed
// on a private/loopback interface, never the public internet. Runs the scoped data/
// http/settings/... operation and returns the result.
import { NextRequest, NextResponse } from 'next/server';
import { loadRuntimeConfig, tokensMatch, type BrokerRequest } from '@kuraykaraaslan-labs/plugin_runtime/server/rpc/protocol';
import { dispatch } from '@kuraykaraaslan-labs/plugin_runtime/server/broker/broker.service';
import { ALL_CAPABILITIES } from '@kuraykaraaslan-labs/plugin_runtime/sdk/types';
import Logger from '@kuraykaraaslan-labs/logger';

/** common.32: the most a caller may ask for, whatever its body says (a manifest's own limits stay below these). */
const MAX_HTTP_TIMEOUT_MS = 60_000;
const MAX_HTTP_BYTES = 50_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_CAPABILITIES = new Set<string>(ALL_CAPABILITIES);

function bounded(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : Math.min(fallback, max);
}

/** The broker body, validated: every field the dispatcher trusts has its type and range checked (common.32). Null on any error. */
function validBody(raw: unknown): BrokerRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.tenantId !== 'string' || !UUID_RE.test(b.tenantId)) return null;
  if (b.configTenantId !== undefined && (typeof b.configTenantId !== 'string' || !UUID_RE.test(b.configTenantId))) return null;
  if (typeof b.pluginId !== 'string' || !b.pluginId || b.pluginId.length > 200) return null;
  if (!Array.isArray(b.capabilities) || !b.capabilities.every((c) => typeof c === 'string' && KNOWN_CAPABILITIES.has(c))) return null;
  if (b.httpAllowlist !== undefined && (!Array.isArray(b.httpAllowlist) || !b.httpAllowlist.every((h) => typeof h === 'string' && h.length <= 255))) return null;
  if (typeof b.capability !== 'string' || typeof b.method !== 'string') return null;
  if (b.args !== undefined && !Array.isArray(b.args)) return null;
  return raw as BrokerRequest;
}

/**
 * E-17: a capability's own refusal ("host not in allowlist: …") is the documented answer to the plugin; an infrastructure
 * failure (a driver or network error with hosts, ports, users, database names) is logged and answered generically.
 */
const ERRNO_RE = /\bE[A-Z]{3,}\b/; // ECONNREFUSED, ENOTFOUND, ETIMEDOUT (case-sensitive: "evil" is not one)
const INFRA_MESSAGE_RE = /getaddrinfo|\b\d{1,3}(?:\.\d{1,3}){3}:\d+|\bfor user\b|\bdatabase\b|\bpassword\b|QueryFailed/i;
function publicMessage(e: unknown): string {
  // Only an Error's own message or a plain string is a refusal text; anything else ({} -> "[object Object]") says nothing.
  const message = e instanceof Error ? e.message : (typeof e === 'string' ? e : '');
  if (!message || ERRNO_RE.test(message) || INFRA_MESSAGE_RE.test(message)) {
    Logger.error(`[plugin-broker] capability failed: ${message}`);
    return 'capability failed';
  }
  return message;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cfg = loadRuntimeConfig();
  const auth = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!tokensMatch(auth, cfg.brokerToken)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: BrokerRequest;
  try {
    const parsed = validBody(await request.json());
    if (!parsed) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    body = parsed;
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  try {
    const value = await dispatch(
      {
        tenantId: body.tenantId,
        ...(body.configTenantId && body.configTenantId !== body.tenantId ? { configTenantId: body.configTenantId } : {}),
        pluginId: body.pluginId,
        capabilities: body.capabilities,
        httpAllowlist: body.httpAllowlist ?? [],
        // common.32: a body-supplied limit can only LOWER the platform ceiling, never lift it.
        limits: {
          httpTimeoutMs: bounded(body.limits?.httpTimeoutMs, cfg.defaultLimits.httpTimeoutMs, MAX_HTTP_TIMEOUT_MS),
          httpMaxBytes: bounded(body.limits?.httpMaxBytes, cfg.defaultLimits.httpMaxBytes, MAX_HTTP_BYTES),
        },
        protectedSettingKeys: Array.isArray(body.protectedSettingKeys) ? body.protectedSettingKeys.map(String) : [],
      },
      body.capability,
      body.method,
      body.args ?? [],
    );
    return NextResponse.json({ value });
  } catch (e: any) {
    // Capability errors return 200 with { error } so the host bridge surfaces them
    // to the plugin as a thrown Error (not a transport failure).
    return NextResponse.json({ error: publicMessage(e) });
  }
}
