import { securitySignalMetricSources } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { registerMetricSource, type MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';

/**
 * `common:boot_task` (runtime phase, every process): the intake's `ai_firewall_signals_*` series (written, buffered, dropped by reason;
 * docs/phases/55-ai-firewall/01 §1.4c) on `/metrics`. Twice over, like automation's metrics bridge: on the observability registry (the
 * web process's `/metrics`) and as process metric sources (the worker's `/metrics`, served by `process_host`). The counts themselves live
 * in `common` (`emitSecuritySignal` counts what it drops whether or not anything reads them). True when the observability side took them.
 */
export async function registerSignalIntakeMetrics(
  register?: (source: MetricSource) => void,
  registerProcess: (source: MetricSource) => void = registerMetricSource,
): Promise<boolean> {
  const sources = securitySignalMetricSources();
  for (const s of sources) registerProcess(s);
  try {
    const reg = register ?? (await import('@kuraykaraaslan-labs/observability/server/metrics')).registerGaugeSource;
    for (const s of sources) reg(s);
    return true;
  } catch {
    return false;
  }
}
