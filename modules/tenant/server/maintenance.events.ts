import Logger from '@kuraykaraaslan-labs/logger';
import type { MaintenanceWindowView } from './maintenance.dto';

/**
 * In-memory maintenance listener registry — the phase-3 status-page bridge
 * seam, in the same shape as the approval decision handlers instrumentation.ts
 * already registers at boot: the OWNING module (tenant) emits, interested
 * modules (observability) register a listener, and no module edge points
 * upward from tenant.
 *
 * Best-effort by contract: a listener that throws is logged and the mutation
 * that emitted the event is never rolled back — the status page missing one
 * refresh must not undo an operator's "end maintenance now".
 */

/**
 * `reminder` is the advance notice (the scheduler's, `maintenancePreNotifyHours` before the start, once per window);
 * announcement turns it into the users' reminder (docs/phases/47-announcements B).
 */
export type MaintenanceEventKind = 'scheduled' | 'updated' | 'reminder' | 'started' | 'ended' | 'cancelled';

/** What else a listener should know about the event. `forced`: an operator started it by hand (unplanned). */
export interface MaintenanceEventMeta {
  forced?: boolean;
}

export type MaintenanceListener = (
  event: MaintenanceEventKind,
  window: MaintenanceWindowView,
  meta: MaintenanceEventMeta,
) => void | Promise<void>;

const listeners: MaintenanceListener[] = [];

export function registerMaintenanceListener(listener: MaintenanceListener): void {
  listeners.push(listener);
}

/** Emits to every listener, isolating failures. Fire-and-forget friendly. */
export async function emitMaintenanceEvent(
  event: MaintenanceEventKind,
  window: MaintenanceWindowView,
  meta: MaintenanceEventMeta = {},
): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(event, window, meta);
    } catch (error) {
      Logger.warn(`[maintenance] listener failed on '${event}' for ${window.windowId}: ${error}`);
    }
  }
}
