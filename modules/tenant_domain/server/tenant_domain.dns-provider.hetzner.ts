/**
 * The DNS-01 writer over the Hetzner Cloud API (phase 56, D342): TXT records added to and removed from one RRSet of one zone. Written on
 * `fetch` (no SDK), against the published spec (https://docs.hetzner.cloud/cloud.spec.json, read 2026-11-04):
 *
 *   POST /zones/{zone}/rrsets/{name}/TXT/actions/add_records     { ttl, records: [{ value }] }  (creates the RRSet when missing)
 *   POST /zones/{zone}/rrsets/{name}/TXT/actions/remove_records  { records: [{ value }] }        (deletes the RRSet when empty)
 *   GET  /zones/actions/{id}                                     status running | success | error
 *   GET  /zones/{zone}                                           zone.authoritative_nameservers.assigned
 *
 * Record names are relative to the zone (`@` for its apex) and a TXT value is quoted. The token never appears in an error or a log line:
 * errors carry the API's `error.code` and `error.message` only.
 */
export interface DnsChallengeWriter {
  /** Adds one TXT value at `fqdn` (inside the writer's zone) and returns when the provider has applied it. */
  add(fqdn: string, value: string): Promise<void>;
  /** Removes one TXT value at `fqdn`; a value or name that is not there is not an error. */
  remove(fqdn: string, value: string): Promise<void>;
  /** The host names that answer authoritatively for the zone (to see what the authority will see). */
  nameservers(): Promise<string[]>;
}

export class DnsProviderError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly code: string | null = null) {
    super(message);
    this.name = 'DnsProviderError';
  }
}

export interface HetznerOptions {
  apiToken: string;
  zone: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  /** TTL of the challenge RRSet (seconds, the API's minimum is 60). */
  ttl?: number;
  actionTimeoutMs?: number;
}

const API = 'https://api.hetzner.cloud/v1';

export class HetznerDnsWriter implements DnsChallengeWriter {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly base: string;
  private readonly zone: string;

  constructor(private readonly opts: HetznerOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.base = (opts.baseUrl ?? API).replace(/\/$/, '');
    this.zone = opts.zone.toLowerCase();
  }

  /** `fqdn` as the RRSet name inside the zone: `x.y.<zone>` → `x.y`, the zone itself → `@`. Refuses a name outside the zone. */
  relativeName(fqdn: string): string {
    const name = fqdn.toLowerCase().replace(/\.$/, '');
    if (name === this.zone) return '@';
    if (!name.endsWith(`.${this.zone}`)) throw new DnsProviderError(`${name} is not inside the zone ${this.zone}`);
    return name.slice(0, -(this.zone.length + 1));
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.opts.apiToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let json: Record<string, unknown> = {};
    try { json = (await res.json()) as Record<string, unknown>; } catch { /* an empty body */ }
    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string; message?: string };
      throw new DnsProviderError(`DNS provider answered ${res.status}${err.code ? ` (${err.code})` : ''}: ${err.message ?? 'no message'}`.slice(0, 300), res.status, err.code ?? null);
    }
    return { status: res.status, json };
  }

  /** Waits until a returned action has finished; an `error` action is an error. */
  private async settle(json: Record<string, unknown>): Promise<void> {
    let action = json.action as { id?: number; status?: string; error?: { code?: string; message?: string } | null } | undefined;
    const deadline = Date.now() + (this.opts.actionTimeoutMs ?? 60_000);
    while (action && action.status === 'running') {
      if (Date.now() >= deadline) throw new DnsProviderError('the DNS provider did not finish the change in time');
      await this.sleep(1_000);
      action = (await this.call('GET', `/zones/actions/${action.id}`)).json.action as typeof action;
    }
    if (action?.status === 'error') throw new DnsProviderError(`the DNS change failed: ${action.error?.message ?? action.error?.code ?? 'error'}`.slice(0, 300), null, action.error?.code ?? null);
  }

  private rrsetPath(fqdn: string): string {
    return `/zones/${encodeURIComponent(this.zone)}/rrsets/${encodeURIComponent(this.relativeName(fqdn))}/TXT`;
  }

  async add(fqdn: string, value: string): Promise<void> {
    const { json } = await this.call('POST', `${this.rrsetPath(fqdn)}/actions/add_records`, { ttl: this.opts.ttl ?? 60, records: [{ value: quoteTxt(value), comment: 'ACME dns-01 (platform certificates, phase 56)' }] });
    await this.settle(json);
  }

  async remove(fqdn: string, value: string): Promise<void> {
    try {
      const { json } = await this.call('POST', `${this.rrsetPath(fqdn)}/actions/remove_records`, { records: [{ value: quoteTxt(value) }] });
      await this.settle(json);
    } catch (err) {
      // Already gone (the RRSet was deleted with its last record, or never written): the goal of a cleanup is met.
      if (err instanceof DnsProviderError && (err.status === 404 || err.code === 'not_found')) return;
      throw err;
    }
  }

  async nameservers(): Promise<string[]> {
    const { json } = await this.call('GET', `/zones/${encodeURIComponent(this.zone)}`);
    const zone = (json.zone ?? {}) as { authoritative_nameservers?: { assigned?: string[] } };
    return (zone.authoritative_nameservers?.assigned ?? []).map((n) => n.replace(/\.$/, '').toLowerCase()).filter(Boolean);
  }
}

/** A TXT value as the Hetzner API takes it: one quoted string (a challenge digest is 43 base64url characters, never split). */
export function quoteTxt(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}
