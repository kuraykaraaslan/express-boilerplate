import Logger from '@kuraykaraaslan-labs/logger'
import { evaluateExpectedProcesses, type ExpectedEvaluation } from './process.registry.service'
import { evaluateCrashLoops, type CrashLoopEvaluation } from './process.scaling.service'

/**
 * Both platform process checks behind the minutely process-check tick (process.registry.job.ts) and its serverless twin
 * (cron-process-check.route.ts): the expected-process count and the supervisor crash loops (07 task 6). A failing
 * crash-loop check is logged and does not hide the expected-process result; a failing expected-process check throws
 * as before.
 */
export async function runProcessChecks(): Promise<ExpectedEvaluation & { crashLoops: CrashLoopEvaluation | null }> {
  const [expected, crashLoops] = await Promise.allSettled([evaluateExpectedProcesses(), evaluateCrashLoops()])
  if (crashLoops.status === 'rejected') Logger.error(`[process-check] crash-loop check failed: ${crashLoops.reason instanceof Error ? crashLoops.reason.message : String(crashLoops.reason)}`)
  if (expected.status === 'rejected') throw expected.reason
  return { ...expected.value, crashLoops: crashLoops.status === 'fulfilled' ? crashLoops.value : null }
}
