/**
 * The process environment as plain data for the supervisor.
 *
 * The supervisor's settings are per kind (`PROC_<KIND>_ENABLED`, `_MIN`, `_MAX` … for any kind string) plus the
 * markers the supervisor sets on its children (`PROC_CHILD`, `PROC_CHILD_INDEX`, `PROC_KIND`, `PROC_SUPERVISOR_NODE`),
 * so they cannot be declared in the static `env` schema. They are read here, in one place, and every value is parsed
 * and validated by its reader (`resolvePolicy`, `reserveFromEnv`, …), which all take the source as a parameter so
 * tests pass their own.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

// eslint-disable-next-line no-restricted-syntax -- dynamic per-kind keys and child markers (see above); each reader validates
export const procEnv = (): EnvSource => process.env;
