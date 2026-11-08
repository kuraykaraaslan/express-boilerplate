/**
 * The supervisor core's logger seam. The core (`supervisor.core.ts`) and the local supervisor (`supervisor.local.ts`) log
 * through this, so they can run in a credential-less process that must not load `@kuraykaraaslan-labs/logger` (which loads
 * the env schema and its required database settings): the script host and the plugin host (07 task 7).
 *
 * Default: the console. `startSupervisor` (the Redis-backed supervisor) installs the platform logger.
 */
export interface SupervisorLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const consoleLogger: SupervisorLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

let current: SupervisorLogger = consoleLogger;

export const supLog: SupervisorLogger = {
  info: (m) => current.info(m),
  warn: (m) => current.warn(m),
  error: (m) => current.error(m),
};

/** Installs the logger the supervisor core uses (null restores the console). */
export function setSupervisorLogger(logger: SupervisorLogger | null): void {
  current = logger ?? consoleLogger;
}
