/**
 * The runbook an alert points to (observability phase 22): the alert's `annotations.runbook` holds the repository path, so a person holding the page reaches the steps from the
 * alert itself. Paths, not URLs: where the guides are published is a deployment's choice.
 */
export const RUNBOOKS = {
  pagingProvider: 'docs/guides/observability/lost-paging-provider.md',
  probeRunner: 'docs/guides/observability/probe-runner-outage.md',
  telemetryStore: 'docs/guides/observability/telemetry-store-full.md',
  keyLeak: 'docs/guides/observability/ingest-key-leak.md',
  statusSnapshot: 'docs/guides/observability/status-snapshot-stale.md',
  alertStorm: 'docs/guides/observability/alert-storm.md',
  platformJobs: 'docs/guides/observability/platform-jobs-silent.md',
  meteringDivergence: 'docs/guides/observability/metering-divergence.md',
} as const
