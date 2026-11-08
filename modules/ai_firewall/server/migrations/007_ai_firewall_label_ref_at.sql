-- kind: expand; reversible: true
-- ai_firewall 007: labels by the time of their behaviour (docs/phases/55-ai-firewall/03 §3.1, §3.5; decision D55-97).
--
-- The retention deletes a label once the behaviour it is about ("refAt": the incident's opening, the event's time) is older than the
-- tenant's retention, not once it was last given ("labelledAt", which a later verdict rewrites), so a re-given verdict cannot keep a
-- label, its actor id and its labeller, a further retention (store/ai_firewall.retention.job.ts pruneLabels). The dataset export reads
-- by "refAt" too (dataset/ai_firewall.dataset-source.ts). This index serves both, per tenant.
--
-- Additive: one index; the previous release ignores it. In `synchronize` mode db:deploy's schema sync applies it from the entity before
-- this file runs; in `migrate` mode this file does. The name matches the entity. Idempotent. RLS is unchanged (004 covers the table).
--
-- Down (exact reverse; NEVER auto-run): 007_ai_firewall_label_ref_at.sql.down.

CREATE INDEX IF NOT EXISTS "idx_ai_firewall_labels_ref_at" ON "ai_firewall_labels" ("tenantId", "refAt");
