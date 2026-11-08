/**
 * Phase 55 00 §0.3 (P-3): the audit trail of the SILENT refusals. A refusal that answers 401 / 403 / 429 without writing anything (a CSRF or Origin refusal,
 * a tenant's IP list, the auth-failure breaker, a provider callback whose signature does not verify, a fleet agent's 401, an infected upload, a plugin
 * sandbox stopped at a bound, an IoT gateway block) is reported here, and the audit log keeps ONE row per (action, tenant, key, minute) with a count:
 * a flood of refusals costs a counter, never a flood of rows.
 *
 * `common` is a leaf and cannot import `audit_log`, so `audit_log` registers the sink at boot (its `runtime` boot task, `audit_log.refusals.ts`), the
 * way the limiter registers the dispatcher's answer watcher (`route-answers.ts`). Held on `globalThis` because the instrumentation hook and the route
 * bundles can each load this file. With no sink (a test, a tool that never booted the app, a process that runs no boot tasks) nothing happens.
 *
 * Reporting never throws and never delays the refusal: the answer is already decided, and the caller does not wait (`void reportRefusal(...)`).
 */

export type RefusalActorType = 'USER' | 'SYSTEM' | 'API_KEY' | 'SERVICE';
export type RefusalSeverity = 'low' | 'medium' | 'high' | 'critical';

/** What the sink needs of a request's headers: `NextRequest.headers`, a `Headers`, or any reader of the same shape. */
export interface RefusalHeaders { get(name: string): string | null }

export interface RefusalEvent {
  /** The audit action (`security.csrf_refused`, ...). */
  action: string;
  /**
   * What the refusals are counted per: an address on human lanes, a credential or node on machine lanes (38 L-4). Left out, the client address the
   * sink reads from `headers` (or `ipAddress`) is the key, `unknown` when there is none.
   */
  key?: string | null;
  /** The tenant the row is written to; null = the ROOT tenant (platform-level refusals). */
  tenantId?: string | null;
  /** The client address when the caller already knows it (from the trusted hops). */
  ipAddress?: string | null;
  /** The request's headers: the sink reads the client address (through the trusted hops) and the user agent from them. */
  headers?: RefusalHeaders | null;
  userAgent?: string | null;
  actorType?: RefusalActorType;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  /** Only for an action whose module keeps its own severity (an add-on's action the audit_log enum does not name); else the enum decides. */
  severity?: RefusalSeverity;
  /** Small, non-secret facts of the FIRST refusal of the minute (a reason code, a provider key, a path). Never a token, a signature or a body. */
  metadata?: Record<string, string | number | boolean | null>;
  /** One short distinct value worth listing (a path, a file key); the row keeps the first few of the minute. */
  sample?: string | null;
}

export type RefusalSink = (event: RefusalEvent) => Promise<void>;

const SINK_KEY = Symbol.for('kuraykaraaslan-labs.common.refusalSink');
const sinkHolder = globalThis as unknown as Record<symbol, RefusalSink | null | undefined>;

/** Install (or with null, remove) the sink. Called once per process at boot by `audit_log`. */
export function setRefusalSink(sink: RefusalSink | null): void {
  sinkHolder[SINK_KEY] = sink;
}

/** Whether a sink is installed (the boot log and tests). */
export function hasRefusalSink(): boolean {
  return typeof sinkHolder[SINK_KEY] === 'function';
}

/** Hands a refusal to the sink. Never rejects: recording a refusal must not change it. */
export async function reportRefusal(event: RefusalEvent): Promise<void> {
  try {
    await sinkHolder[SINK_KEY]?.(event);
  } catch {
    // a failing sink never changes the refusal
  }
}

/** The provider part of the key of a callback whose provider segment the module does not recognise. */
export const UNKNOWN_PROVIDER = 'unknown';

/**
 * `security.inbound_signature_invalid`: a provider callback (mail, telephony, carrier, chat platform, payment, an automation hook) whose signature,
 * MAC or shared secret does not verify. A provider is a machine, so the refusals are counted per endpoint credential (module, provider and, when
 * there is one, the account or hook), never per address (38 L-4); the address is recorded, not keyed. `reason` is the verifier's code
 * (`SIGNATURE_INVALID`, `TIMESTAMP_OUTSIDE_WINDOW`, ...), never what was sent.
 *
 * `provider` is a provider the module RECOGNISES (a configured one, a stored account's). A segment the module takes from the URL without
 * recognising it (one secret per tenant verifies every segment) is `claimedProvider`: kept, clipped, in the metadata and as a sample, and keyed as
 * `UNKNOWN_PROVIDER`, so a forged-callback flood that rotates the segment stays one bucket per endpoint and minute (phase 55 00 review).
 */
export function reportInboundSignatureInvalid(input: {
  module: string;
  provider?: string | null;
  /** A provider segment from the URL the module did not recognise: recorded, never part of the key. */
  claimedProvider?: string | null;
  /** The account, line or hook the callback named, when the endpoint has one (part of the key). */
  credential?: string | null;
  tenantId?: string | null;
  headers?: RefusalHeaders | null;
  reason?: string | null;
}): Promise<void> {
  const claimed = typeof input.claimedProvider === 'string' && input.claimedProvider ? input.claimedProvider.slice(0, 64) : null;
  const provider = input.provider || (claimed ? UNKNOWN_PROVIDER : null);
  const endpoint = [input.module, provider, input.credential].filter((p): p is string => typeof p === 'string' && p.length > 0).join(':');
  return reportRefusal({
    action: 'security.inbound_signature_invalid',
    tenantId: input.tenantId ?? null,
    key: endpoint,
    headers: input.headers ?? null,
    resourceType: 'inbound_endpoint',
    resourceId: endpoint,
    metadata: { module: input.module, provider: input.provider || claimed || null, ...(claimed && !input.provider ? { providerRecognised: false } : {}), reason: input.reason ?? null },
    ...(claimed && !input.provider ? { sample: claimed } : {}),
  });
}
