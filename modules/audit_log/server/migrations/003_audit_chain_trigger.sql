-- kind: expand
-- audit_log 003: hardened audit chain, step 3 of 3 - the trigger (docs/phases/02-fleet/10-roadmap/02-phases-5-to-9.md, Phase 5).
--
-- Installs audit_chain_before_insert() (migration 002) on audit_logs. From here on every INSERT is either
--   * a v1 row: the writer supplied rowHash (the JavaScript path of today, an N-1 node, a seed); passed through
--     untouched and marked hashVersion NULL, because a writer that supplies its own hash cannot claim v2; or
--   * a v2 row: no rowHash supplied; chained, timestamped and hashed here, under the same advisory lock key as the
--     JavaScript writer, so the two cannot fork the chain during a rolling deploy.
-- A tenant whose audit_chain_policy row says 'sealed' refuses the first kind (and bare actor ids) outright.
--
-- Not repeatable: the body lives in 002 and can be corrected there; this file only attaches it. DROP + CREATE makes it
-- idempotent. Rolling back to N-1 stays safe: an N-1 writer reads the head's rowHash (a v2 row's hash is a plain
-- string to it) and writes v1 rows after it. N-1's own verifier cannot recompute v2 rows and will report them as
-- broken, so keep every tenant on the legacy chain until N-1 is gone.

DROP TRIGGER IF EXISTS audit_chain_before_insert ON "audit_logs";
CREATE TRIGGER audit_chain_before_insert
  BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();
