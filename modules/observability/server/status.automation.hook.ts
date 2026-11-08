import Logger from '@kuraykaraaslan-labs/logger'

/**
 * The seam between a component's status change and the auto-post templates. Loaded on demand and never awaited by the caller: the
 * automation reaches into incidents and subscribers, and the probe that moved a component must neither wait for that nor fail because of it.
 */
export function runStatusAutomation(tenantId: string, componentId: string): void {
  void import('./status.automation.service')
    .then(({ default: Service }) => Service.onComponentChanged(tenantId, componentId))
    .catch((err) => Logger.warn(`[observability] status automation unavailable: ${err instanceof Error ? err.message : String(err)}`))
}
