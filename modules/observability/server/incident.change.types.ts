/** One change in the world that might explain an incident: a deploy, a settings or flag change, a module switched on or off. */
export interface ChangeEventSpec {
  /** When it happened. */
  at: Date | string
  /** What kind of change: it only drives the icon and the filter. */
  kind: 'deploy' | 'config' | 'module' | 'flag' | 'access' | 'other'
  title: string
  /** A person or system name, never an id that means nothing to the reader. */
  actor?: string
  /** A link target or record reference for the reader to follow. */
  ref?: string
}

/**
 * Default export of an `observability:change-event` contribution. Return the changes this module knows of between `from` and `to` for THIS
 * tenant (an empty list is fine). Throwing means "I could not tell": the incident view simply shows what the other sources found.
 */
export interface ChangeEventProvider {
  listChanges(tenantId: string, from: Date, to: Date): Promise<ChangeEventSpec[]>
}

export const CHANGE_EVENT_POINT = 'observability:change-event'
