import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Fleet break-glass provenance (docs/phases/02-fleet 04 §6, step 5): "every request in that session is audited with the grant id and `actorTenantId` =
 * the fleet tenant". The request's log context carries it, and the auth guard marks the request once; `log()` reads it back, so no call site can
 * pass it (hundreds of them write audit rows, and the one that was missed would be the row somebody later asks about).
 *
 * Only rows written INTO the tenant the session is for are stamped: a request can write rows in more than one tenant (a platform-level event falls
 * back to the root tenant), and stamping the others would put the fleet's id into an audit trail that has nothing to do with it.
 */
const BG_GRANT = 'breakGlassGrantId';
const BG_INTO = 'breakGlassIntoTenantId';

export function markBreakGlassRequest(grantId: string, intoTenantId: string): boolean {
  try {
    return Logger.annotateContext({ [BG_GRANT]: grantId, [BG_INTO]: intoTenantId });
  } catch {
    return false;
  }
}

/** The break-glass grant id behind the current request for a row in `rowTenantId`, or null. Never throws. */
export function breakGlassGrantFor(rowTenantId: string): string | null {
  try {
    const ctx = Logger.getContext();
    const id = ctx[BG_GRANT];
    return typeof id === 'string' && ctx[BG_INTO] === rowTenantId ? id : null;
  } catch {
    return null;
  }
}
