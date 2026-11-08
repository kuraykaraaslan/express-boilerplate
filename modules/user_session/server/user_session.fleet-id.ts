import type { SessionMeta } from './user_session.types';

/**
 * What a session minted FROM another session (the tenant switcher's exchange) inherits of a Fleet ID login (FID-07): its `sid`, so the hub's
 * back-channel logout (by `sub`, `sid` or both) ends the derived session together with the original, its hour cap, and `notAfter`, the original
 * login's own deadline (creation + `maxHours`, or an earlier `notAfter` it inherited), so a hop to another tenant cannot restart the cap and the
 * derived session never outlives the login it came from. Without this a derived session carried no `metadata.fleetId`: the logout skipped it and
 * the ordinary session policy let it refresh for days. `undefined` for a session that is not a Fleet ID session.
 */
export function derivedFleetIdSession(
  source: { createdAt?: Date | string | null; metadata?: unknown },
  now: number = Date.now(),
): { sid: string | null; maxHours: number; notAfter: string } | undefined {
  const fleetId = (source.metadata as SessionMeta | null | undefined)?.fleetId;
  if (!fleetId) return undefined;
  const created = source.createdAt ? new Date(source.createdAt).getTime() : NaN;
  // A source with no readable creation time is treated as created now: the derived session still gets no more than the cap.
  const byHours = (Number.isNaN(created) ? now : created) + fleetId.maxHours * 60 * 60 * 1000;
  const inherited = fleetId.notAfter ? Date.parse(fleetId.notAfter) : Infinity;
  // An unreadable inherited deadline is already past (createSession then refuses), never "no deadline".
  const notAfter = Math.min(byHours, Number.isNaN(inherited) ? 0 : inherited);
  return { sid: fleetId.sid, maxHours: fleetId.maxHours, notAfter: new Date(notAfter).toISOString() };
}

/**
 * What a session minted FROM another session (a tenant switch, entering a freshly opened organization, either here or through a handoff)
 * inherits of it. A session derived from a Fleet ID session stays one (FID-07): same `sid`, and never longer than the login it came from, so
 * the hub's back-channel logout ends it with the original and the hour cap cannot be restarted by switching tenant. It also keeps the
 * source's `amr` (FID-08): switching tenant is no new login, so a passkey session must not arrive as `acr NONE`.
 */
export function derivedSessionClaims(source: { createdAt?: Date | string | null; metadata?: unknown } | null | undefined): {
  fleetId?: { sid: string | null; maxHours: number; notAfter: string };
  amr?: string[];
} {
  if (!source) return {};
  const fleetId = derivedFleetIdSession(source);
  const amr = (source.metadata as SessionMeta | null | undefined)?.amr;
  return { ...(fleetId ? { fleetId } : {}), ...(amr?.length ? { amr: [...amr] } : {}) };
}
