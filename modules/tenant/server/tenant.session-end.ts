/**
 * D249: the `sessionEndOrderedBy` of a lifecycle event (`tenant.extension-points.ts`), from what the change's own transaction recorded
 * (`recordSessionEndInTx`, `session_end:order_source`); nothing when none was. A sink of a module named there skips the event.
 */
export function sessionEndOrderedBy(ends: { orderedBy(tenantId: string): string[] } | null | undefined, tenantId: string): { sessionEndOrderedBy?: string[] } {
  const by = ends?.orderedBy(tenantId) ?? []
  return by.length ? { sessionEndOrderedBy: by } : {}
}
