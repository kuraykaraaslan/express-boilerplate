/**
 * LANE_POLICY — the one static table that says which abuse-class controls apply to which caller class (docs/phases/38-security,
 * phase 00, decision L-3: a lookup, not a policy engine; no per-tenant overrides, no functions, no composable rules).
 *
 * Lanes answer WHICH abuse controls apply; ABAC keeps answering whether the actor is ALLOWED. The two never blur.
 * Decision L-4: human-facing controls (captcha, step-up, geo anomaly, IP bans) are never switched on for a machine or
 * device lane; machine/device abuse is keyed per credential / node / endpoint, never per IP (carrier and site NAT would ban fleets).
 */

export const LANES = [
  'human-web',
  'human-native',
  'machine-apikey',
  'machine-agent',
  'machine-mcp',
  'internal-cron',
  'provider-webhook',
  'public-anon',
  'device-iot',
] as const;

export type Lane = (typeof LANES)[number];

export type LaneLimiterKeying = 'ip' | 'credential' | 'node' | 'endpoint';

export type LanePolicy = {
  /** Phase 00 (assertCsrf): the signed double-submit token is enforced on state-changing requests of this lane. */
  readonly csrf: boolean;
  /** Phase 02: a CAPTCHA challenge may be armed on repeated failures. */
  readonly captcha: boolean;
  /** Phase 03: a risk-based step-up (OTP / email confirmation) may be demanded. */
  readonly stepUp: boolean;
  /** Phase 03: login geo / impossible-travel detection applies. `'alerts-only'` records and notifies but never steps up or denies. */
  readonly geoAnomaly: boolean | 'alerts-only';
  /** Phase 02: failures of this lane feed the cross-account IP strike store and an active ban is enforced. `'per-credential'` / `'per-endpoint'` ban the credential or endpoint, never the IP. */
  readonly banParticipation: boolean | 'per-credential' | 'per-endpoint' | 'per-node';
  /** Phase 00/01 (Limiter.checkRateLimit): what a rate-limit bucket is keyed on. */
  readonly limiterKeying: LaneLimiterKeying;
  /** Phase 00/01 (Limiter.checkRateLimit): behaviour when the limiter store is down for an auth-class scope. */
  readonly limiterFailMode: 'open' | 'closed';
};

export const LANE_POLICY: Readonly<Record<Lane, LanePolicy>> = {
  'human-web': {
    csrf: true, captcha: true, stepUp: true, geoAnomaly: true, banParticipation: true,
    limiterKeying: 'ip', limiterFailMode: 'closed',
  },
  'human-native': {
    csrf: false, captcha: false, stepUp: true, geoAnomaly: 'alerts-only', banParticipation: true,
    limiterKeying: 'ip', limiterFailMode: 'closed',
  },
  'machine-apikey': {
    csrf: false, captcha: false, stepUp: false, geoAnomaly: false, banParticipation: 'per-credential',
    limiterKeying: 'credential', limiterFailMode: 'closed',
  },
  'machine-agent': {
    csrf: false, captcha: false, stepUp: false, geoAnomaly: false, banParticipation: 'per-node',
    limiterKeying: 'node', limiterFailMode: 'closed',
  },
  // docs/phases/57-mcp-server D57-7: an MCP host acting through an OAuth grant of a person. No human control can run (the agent cannot
  // solve a captcha or a step-up); hosts share egress, so limits and bans bind to the grant, never the address.
  'machine-mcp': {
    csrf: false, captcha: false, stepUp: false, geoAnomaly: false, banParticipation: 'per-credential',
    limiterKeying: 'credential', limiterFailMode: 'closed',
  },
  'internal-cron': {
    csrf: false, captcha: false, stepUp: false, geoAnomaly: false, banParticipation: false,
    limiterKeying: 'endpoint', limiterFailMode: 'closed',
  },
  'provider-webhook': {
    csrf: false, captcha: false, stepUp: false, geoAnomaly: false, banParticipation: 'per-endpoint',
    limiterKeying: 'endpoint', limiterFailMode: 'closed',
  },
  'public-anon': {
    csrf: false, captcha: true, stepUp: false, geoAnomaly: false, banParticipation: true,
    limiterKeying: 'ip', limiterFailMode: 'closed',
  },
  // Reserved: the IoT gateway classifies in its own entry; the row exists so the table is complete.
  'device-iot': {
    csrf: false, captcha: false, stepUp: false, geoAnomaly: false, banParticipation: 'per-credential',
    limiterKeying: 'credential', limiterFailMode: 'closed',
  },
};
