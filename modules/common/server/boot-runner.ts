import type { BootTask } from './boot-tasks';

export interface BootLogger {
  info(message: string): void;
  warn(message: string): void;
  /** Used for a refused boot when present; `warn` otherwise. */
  error?(message: string): void;
}

/** Runs each task in its own try so one missing or broken module cannot block the rest; returns the failed names. */
export async function runBootTasks(tasks: readonly BootTask[], failure: (name: string, reason: string) => void): Promise<string[]> {
  const failed: string[] = [];
  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      failed.push(name);
      failure(name, err instanceof Error ? err.message : String(err));
    }
  }
  return failed;
}
