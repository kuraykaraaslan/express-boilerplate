/**
 * The last probe sweep THIS process ran, for the operator usage view: is the pipeline shedding (truncating) right now? Per process, like the
 * probe-target sync map. A leaf module on purpose: the usage screen reads it without importing the BullMQ queue the job file creates on import.
 */
export interface SweepRecord { tenants: number; due: number; probed: number; failed: number; truncated: boolean; at: string; /** How long the sweep took: the next sweep's due-slack follows it (uptime.probe.job.ts). */ ms?: number }

let last: SweepRecord | null = null
export function recordSweep(r: SweepRecord): void { last = r }
export function getLastSweep(): SweepRecord | null { return last }
