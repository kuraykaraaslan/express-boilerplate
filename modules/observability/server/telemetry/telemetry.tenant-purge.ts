import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { getTelemetryBackend } from './telemetry.config';
import { purgeTenantTelemetry } from './telemetry.lifecycle';

/**
 * Contributes to `tenant:purge_step`: a purged tenant's telemetry is erased from the backend, for the signals the backend can erase (a signal it
 * cannot erase is left to the backend's own retention and reported by the lifecycle API). Best-effort like every purge step.
 */
const step: TenantPurgeStep = {
  async purge(tenantId) {
    await purgeTenantTelemetry(getTelemetryBackend(), tenantId);
  },
};

export default step;
