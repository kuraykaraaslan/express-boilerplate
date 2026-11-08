/** What the telemetry query routes share: the service dependencies, resolved per request so a test can swap the backend or the limits. */
import { requireBackend } from './telemetry.http';
import { getTelemetryLimits } from './telemetry.limits';
import { withQueryTiming } from './telemetry.query-time';
import type { QueryDeps } from './telemetry.query.service';

// The backend is wrapped so the time it spends answering a tenant's query is metered (phase 16: query seconds).
export const queryDeps: QueryDeps = { backend: () => withQueryTiming(requireBackend()), limits: getTelemetryLimits };
