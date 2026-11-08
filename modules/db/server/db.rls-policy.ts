/**
 * The ONE definition of the generated tenant-policy shape (docs/phases/10-db hardening
 * addendum, migration 127).
 *
 * Both writers of tenant policies take their SQL from here:
 *   - `modules/db/scripts/gen-rls-policies.mts` (migration 127 and the cutover scripts),
 *   - `db.time-series.rollup.ts` (rollup and watermark tables created at deploy).
 * so the two cannot drift apart, and `rls.policy-shape.test.ts` fails if either
 * ever emits the pre-127 shape again.
 *
 * WHY THIS SHAPE (docs/concepts/iot-telemetry/phases/09-isolation-performance-benchmark.md):
 *
 *   tenant_isolation     USING ("tenantId" = (SELECT app_current_tenant()))   -- everybody
 *   tenant_admin_bypass  TO app_admin USING ((SELECT app_rls_bypass()))       -- app_admin only
 *
 * replaces the single `app_rls_bypass() OR "tenantId" = app_current_tenant()`.
 * `(SELECT fn())` makes the call an InitPlan: evaluated once per statement, not
 * once per candidate row, and a statement with no tenant context short-circuits
 * to a One-Time Filter instead of scanning the table. Permissive policies are
 * OR-ed, so the effective row filter is unchanged:
 *
 *   runtime role (not an app_admin member): tenant match only (the bypass policy
 *                                           does not apply to it at all);
 *   app_admin member:                       bypass OR tenant match, as before.
 */

export const TENANT_POLICY = 'tenant_isolation';
export const BYPASS_POLICY = 'tenant_admin_bypass';
/** Names an earlier migration used for the tenant policy; dropped when the pair is (re)created. */
export const LEGACY_TENANT_POLICIES = ['tenant_self'] as const;

/** `"tenantId" = (SELECT app_current_tenant())` for an already-quoted column (or a `%2$I` placeholder). */
export const tenantPredicate = (column: string): string => `${column} = (SELECT app_current_tenant())`;
export const BYPASS_PREDICATE = '(SELECT app_rls_bypass())';

/**
 * The statements that (re)install the pair on one table. `table` and `column`
 * are inserted verbatim: pass `"quoted"` identifiers at runtime, or `%1$I` /
 * `%2$I` placeholders when the text goes through plpgsql `format()`.
 */
export function tenantPolicyStatements(table: string, column: string): string[] {
  return [
    ...[TENANT_POLICY, ...LEGACY_TENANT_POLICIES, BYPASS_POLICY].map((p) => `DROP POLICY IF EXISTS ${p} ON ${table}`),
    `CREATE POLICY ${TENANT_POLICY} ON ${table}
       USING (${tenantPredicate(column)})
       WITH CHECK (${tenantPredicate(column)})`,
    `CREATE POLICY ${BYPASS_POLICY} ON ${table} TO app_admin
       USING (${BYPASS_PREDICATE})
       WITH CHECK (${BYPASS_PREDICATE})`,
  ];
}

/**
 * True for the pre-127 single-policy shape. Matches both the catalog rendering
 * (`pg_get_expr`) and the source text, whitespace-insensitively. A guard, not a
 * parser: anything that evaluates the bypass function per row inside an OR with
 * the tenant comparison is "the old shape".
 */
export function isLegacyOrShape(expr: string): boolean {
  const e = expr.replace(/\s+/g, ' ');
  return /app_rls_bypass\(\)\s*OR\b/i.test(e) || /\bOR\s*\(?\s*"?\w+"?\s*=\s*app_current_tenant\(\)/i.test(e);
}
