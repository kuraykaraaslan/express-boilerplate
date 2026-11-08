/**
 * Maintenance refusals added by the 41-ui-fixes/09 round. The older window messages (not found, closed, invalid
 * transition) stay in tenant.messages.ts; these are the ones the editor and the console's guards answer with.
 */
const MaintenanceMessages = {
  /** 41-ui-fixes/09 B1.2: the window would 503 the caller's own console and its End button. */
  LOCKS_OUT_CALLER:
    'This window would lock you out: your role is not among the roles that bypass the gate, so you could not reach the maintenance console to end it. Add your role to the bypass roles.',
  /** 41-ui-fixes/09 B1.4: checked on the merged values of an edit (the create DTO checks its own). */
  END_BEFORE_START: 'The end of a maintenance window must be after its start',
  /** 41-ui-fixes/09 B1.5: a ROUTE window without a pattern gates nothing and reads as "everything". */
  ROUTE_PATTERNS_REQUIRED: 'A route window needs at least one route pattern',
  /** 2.1: SYSTEM windows gate every tenant; only a platform admin schedules or changes them. */
  SYSTEM_REQUIRES_PLATFORM_ADMIN: 'SYSTEM-scope maintenance requires a platform ADMIN',
} as const;

export default MaintenanceMessages;
