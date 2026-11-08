-- kind: expand; reversible: true
-- ai_firewall 005: the run of a synthetic or benign-traffic label (docs/phases/55-ai-firewall/03 §3.3, §3.4; decisions D55-82 to D55-86).
--
-- "ai_firewall_labels" gets "runId": the probe run (`scripts/fw-probe`, source synthetic) or the benign-traffic run (e2e tester runs,
-- the siege server's normal scenarios, the demo's scripted traffic; source benign_traffic) whose stamped events the label collector
-- turned into labels (labels/ai_firewall.probe-labels.ts), so one run's labels can be found, exported (03 §3.5) or withdrawn together.
-- Null for every other source. A run id is the runner's own random name, no personal data. The partial index serves "this run's labels".
--
-- Additive: a nullable column and an index; the previous release neither reads nor writes them. In `synchronize` mode db:deploy's
-- schema sync applies them from the entity before this file runs; in `migrate` mode this file does. Names match the entity. Idempotent.
-- RLS is unchanged (the policy pair and FORCE of 004 cover the table).
--
-- Down (exact reverse; NEVER auto-run): 005_ai_firewall_label_runs.sql.down.

ALTER TABLE "ai_firewall_labels" ADD COLUMN IF NOT EXISTS "runId" character varying(64);
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_labels_run" ON "ai_firewall_labels" ("tenantId", "runId") WHERE "runId" IS NOT NULL;
