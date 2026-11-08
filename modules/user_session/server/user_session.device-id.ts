import { randomUUID } from 'node:crypto';

/**
 * D28 (docs/audits/2026-10-28-lead-decisions.md): the per-browser "device id". A random UUID the server hands out in an httpOnly cookie
 * the first time a browser signs in and reads back at every later sign-in; a new sign-in from the same device replaces that device's
 * earlier session instead of adding another row. It is NOT a credential and NOT part of the token binding (`deviceFingerprint` still
 * does that, and still changes with the IP): losing the cookie only means the next sign-in is a new device, and presenting somebody
 * else's id is useless because an id can only replace sessions of the SAME user in the SAME tenant (it is unguessable, and the person
 * it would replace could already be signed out by the person holding the password).
 */
export const DEVICE_ID_COOKIE = 'device-id';
export const DEVICE_ID_DAYS = 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie's value when it is one of ours (a UUID), else null: a malformed or hostile value is treated as no cookie. */
export function parseDeviceId(value: string | null | undefined): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

export function newDeviceId(): string {
  return randomUUID();
}

/** httpOnly, site-wide (`/`: path tenancy shares one browser across tenants, and a device is a browser, not a tenant), one year, sliding. */
export function deviceIdCookieOptions(secure: boolean) {
  const maxAge = 60 * 60 * 24 * DEVICE_ID_DAYS;
  return secure
    ? { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge }
    : { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge };
}
