/**
 * Login risk assessment for a session about to be issued (docs/phases/38-security/03-login-anomaly-and-step-up.md 3.1 to 3.3).
 *
 * The detector (`detectAnomaly`: haversine implied speed, new country, Tor / proxy / VPN) existed with no caller. This runs it on
 * every human login: geo of the login address against the user's most recent session. The response is a step-up, never a hard
 * deny (A-6): `stepUp` is true for impossible travel or a Tor exit node on the web lane, and the caller makes the session
 * `otpVerifyNeeded` when the user has a second factor. Proxy / VPN and a new country alone are logged and alerted, not stepped up
 * (defaults of 3.2). The device (native app) lane gets alerts only (mobile IP churn, lane table `geoAnomaly: 'alerts-only'`).
 * Machine lanes never create sessions through here.
 *
 * Phase 55 00.4 (P-4): this is the ONE login-anomaly detector. The new-address / new-device check that user_security's
 * `recordLoginAttempt` ran on password sign-ins (and webhooked a second time per login) moved here as the reasons `new_ip` and
 * `new_device`, for every sign-in method. One assessment, one list of reasons, one
 * audit row `auth.login_anomaly` and ONE `security.login_anomaly` webhook per login (user_session.crud.service reportLoginAnomaly).
 * The row's severity says how much the reasons weigh (`loginAnomalySeverity`), so a new address alone never rides
 * `audit.high_risk`. The per-request country change (tenant_session `tenant.session.geo_anomaly`) stays its own signal: it
 * happens after the login, inside a live session.
 */
import { getDataSource } from '@kuraykaraaslan-labs/db';
import UserAgentService from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.service';
import { detectAnomaly } from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.geo';
import { parseUserAgent } from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.parse';
import type { GeoLocation } from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.types';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { UserSession as UserSessionEntity } from './entities/user_session.entity';
import { UserSecurity as UserSecurityEntity } from '@kuraykaraaslan-labs/user_security/server/entities/user_security.entity';
import { sessionAudienceLane } from '@kuraykaraaslan-labs/common/server/lane';
import { LANE_POLICY } from '@kuraykaraaslan-labs/common/server/lane.policy';

/** The geo lookup is awaited on the login path, so it is bounded; a slow provider degrades to "no geo" (the old fire-and-forget annotation still runs). */
export const GEO_LOOKUP_TIMEOUT_MS = 1500;

/** Reasons that demand a step-up on the web lane (3.2 defaults: velocity and Tor; proxy / VPN / new country are log-only). */
export const STEP_UP_REASONS: readonly string[] = ['impossible_travel', 'tor_exit_node'];

/** Reasons that are worth an alert on their own but never a step-up: an anonymising network or another country (3.2 defaults). */
export const MEDIUM_REASONS: readonly string[] = ['new_country', 'proxy', 'vpn'];

/** Every reason the one detector can give (phase 55 00.4). `new_ip` and `new_device` are the weakest: context for the firewall, low rows. */
export const LOGIN_ANOMALY_REASONS = ['impossible_travel', 'tor_exit_node', 'new_country', 'proxy', 'vpn', 'new_ip', 'new_device'] as const;

export type LoginRisk = {
  geo: GeoLocation | null;
  reasons: string[];
  stepUp: boolean;
  /** The tenant opted into hard-denying a risky web sign-in (A-6 default is step-up). */
  deny?: boolean;
  /** The address of the session the reasons were measured against (`new_ip`), for the audit row and the webhook. */
  previousIp?: string | null;
  /** The browser and OS this sign-in came from (`Chrome on Windows`), when its User-Agent says. */
  device?: string | null;
};

/**
 * Phase 55 00.4: the honest severity of one anomalous login. `high` (rides `audit.high_risk` and the `login-anomaly` alert rule) for
 * what forces a step-up or a deny: impossible travel, a Tor exit node, a denied sign-in. `medium` for a new country, a proxy or a
 * VPN. `low` for a new address or device alone, which is everyday life (a phone on a new network) and only context for scoring.
 */
export function loginAnomalySeverity(reasons: readonly string[], opts: { denied?: boolean } = {}): 'low' | 'medium' | 'high' {
  if (opts.denied || reasons.some((r) => STEP_UP_REASONS.includes(r))) return 'high';
  if (reasons.some((r) => MEDIUM_REASONS.includes(r))) return 'medium';
  return 'low';
}

/**
 * The device a User-Agent names, as a stable label: browser, OS and form factor, never the version (a browser update is not a new
 * device). Null when the string says nothing usable. Never throws: a parser surprise is "unknown", not a failed assessment.
 */
export function deviceLabelOf(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  try {
    const info = parseUserAgent(userAgent);
    const parts = [info.browserName, info.osName].filter((p) => p && !/^unknown$/i.test(String(p)));
    if (parts.length === 0) return null;
    return `${parts.join(' on ')}${info.deviceType && info.deviceType !== 'Desktop' ? ` (${info.deviceType})` : ''}`;
  } catch {
    return null;
  }
}

const NO_RISK: LoginRisk = { geo: null, reasons: [], stepUp: false };

/**
 * Per-tenant policy (38-security 3.2): `loginAnomalyResponse` = step_up (default) | deny, `loginAnomalyVelocityKmh` = implied
 * speed that counts as impossible (default and MAXIMUM 900).
 *
 * MS-35: only responses at least as strong as the default remain. `alert_only` (find, audit, never step up) is removed: a
 * stored `alert_only`, like any unknown value, reads as `step_up`. The speed can be tightened, never loosened: a stored value
 * above 900 km/h reads as 900 (it used to be accepted up to 5000, which let a tenant switch impossible travel off).
 */
export const LOGIN_ANOMALY_RESPONSE_KEY = 'loginAnomalyResponse';
export const LOGIN_ANOMALY_VELOCITY_KEY = 'loginAnomalyVelocityKmh';
export type LoginAnomalyResponse = 'step_up' | 'deny';
/** The default speed and the ceiling: no tenant may raise the impossible-travel threshold above it. */
export const LOGIN_ANOMALY_MAX_VELOCITY_KMH = 900;
const LOGIN_ANOMALY_MIN_VELOCITY_KMH = 100;

export async function loginRiskPolicy(tenantId: string | undefined): Promise<{ response: LoginAnomalyResponse; velocityKmh: number }> {
  if (!tenantId) return { response: 'step_up', velocityKmh: LOGIN_ANOMALY_MAX_VELOCITY_KMH };
  // Literal keys on purpose: the setting-key catalog is built from them, and the settings API refuses a key that is not in it.
  const [r, v] = await Promise.all([
    SettingService.getValue(tenantId, 'loginAnomalyResponse').catch(() => null),
    SettingService.getValue(tenantId, 'loginAnomalyVelocityKmh').catch(() => null),
  ]);
  const response: LoginAnomalyResponse = r === 'deny' ? 'deny' : 'step_up';
  const n = Number(v);
  const velocityKmh = !Number.isFinite(n) || n < LOGIN_ANOMALY_MIN_VELOCITY_KMH
    ? LOGIN_ANOMALY_MAX_VELOCITY_KMH
    : Math.min(n, LOGIN_ANOMALY_MAX_VELOCITY_KMH);
  return { response, velocityKmh };
}

/** The full geo as it is persisted on the session (3.1): coordinates and network flags included, which velocity math needs. */
export function geoForSession(geo: GeoLocation): NonNullable<import('./user_session.types').SessionMeta['geo']> {
  return {
    city: geo.city, state: geo.state, country: geo.country, countryCode: geo.countryCode,
    latitude: geo.latitude ?? null, longitude: geo.longitude ?? null,
    ...(geo.isTor ? { isTor: true } : {}), ...(geo.isProxy ? { isProxy: true } : {}), ...(geo.isVpn ? { isVpn: true } : {}),
  };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  work.catch(() => {}); // a late rejection after the bound must not surface as unhandled
  try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
}

/**
 * Phase 55 00.8: whether a sign-in of this token audience may be stepped up (or, on the tenant's opt-in, denied) for a geo anomaly,
 * read from the lane table instead of `audience === 'web'`: the audience's lane (`sessionAudienceLane`: web is human-web, device is
 * human-native) must have `stepUp` and a full `geoAnomaly` (`'alerts-only'` records and notifies, never steps up; 38 L-4, A-6).
 */
export function laneStepsUp(audience: string | null | undefined): boolean {
  const policy = LANE_POLICY[sessionAudienceLane(audience)];
  return policy.stepUp && policy.geoAnomaly === true;
}

export async function assessLogin(input: {
  userId: string;
  ipAddress?: string;
  tenantId?: string;
  audience: 'web' | 'device' | string;
  /** The sign-in's User-Agent: `new_device` is measured on it (phase 55 00.4). */
  userAgent?: string;
  now?: Date;
}): Promise<LoginRisk> {
  if (!input.ipAddress) return NO_RISK;
  try {
    // The previous session is read even when the geo lookup gives nothing: a new address or device needs no geo. The last sign-in's
    // place (user_securities.lastLoginIp / lastLoginDevice, written by createSession for every method AFTER this assessment) is read too:
    // it survives a sign-out, an expiry prune, a security lock and a refresh-reuse wipe, which all delete the session rows.
    const [geoRaw, prev, last] = await Promise.all([
      // A failing provider is "no geo", like a slow one: it must not take the address and device reasons down with it.
      withTimeout(Promise.resolve().then(() => UserAgentService.getGeoLocation(input.ipAddress!, input.tenantId)), GEO_LOOKUP_TIMEOUT_MS).catch(() => null),
      getDataSource().then((ds) => ds.getRepository(UserSessionEntity).findOne({ where: { userId: input.userId }, order: { createdAt: 'DESC' } })),
      getDataSource()
        .then((ds) => ds.getRepository(UserSecurityEntity).findOne({ where: { userId: input.userId } }))
        .then((r) => (r ? { ip: (r as { lastLoginIp?: string | null }).lastLoginIp ?? null, device: (r as { lastLoginDevice?: string | null }).lastLoginDevice ?? null } : null))
        .catch(() => null),
    ]);
    const geo = geoRaw && (geoRaw.country || geoRaw.countryCode || geoRaw.isTor) ? geoRaw : null;

    const reasons: string[] = [];
    // Only the geo reasons read the tenant's policy (the speed, and the response to the two that step up).
    const policy = geo ? await loginRiskPolicy(input.tenantId) : null;
    if (geo && policy) {
      const prevGeo = (prev?.metadata as { geo?: GeoLocation } | null | undefined)?.geo ?? null;
      reasons.push(...detectAnomaly(
        prev && prevGeo ? { geo: prevGeo, at: prev.createdAt } : null,
        { geo, at: input.now ?? new Date() },
        { velocityKmh: policy.velocityKmh },
      ).reasons);
    }
    // Phase 55 00.4: the second detector, merged. A first sign-in (no record of an earlier one) is never anomalous; afterwards another
    // address, or another browser / OS, is a weak reason of its own. Measured against the last sign-in's persistent place first, the
    // newest surviving session only when that place was never recorded (an account from before the record, or one without a row).
    const previousIp = last?.ip ?? prev?.ipAddress ?? null;
    if (previousIp && input.ipAddress !== previousIp) reasons.push('new_ip');
    const device = deviceLabelOf(input.userAgent);
    const previousDevice = deviceLabelOf(last?.device ?? prev?.userAgent);
    if (device && previousDevice && device !== previousDevice) reasons.push('new_device');

    const risky = laneStepsUp(input.audience) && reasons.some((r) => STEP_UP_REASONS.includes(r));
    const extra = { ...(reasons.length && previousIp ? { previousIp } : {}), ...(reasons.length && device ? { device } : {}) };
    // The native app lane is alerts only whatever the tenant says (mobile IP churn); the web lane always steps up or denies.
    return {
      geo, reasons, stepUp: risky && policy?.response === 'step_up',
      ...(risky && policy?.response === 'deny' ? { deny: true } : {}),
      ...extra,
    };
  } catch {
    return NO_RISK;
  }
}
