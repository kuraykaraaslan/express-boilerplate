-- kind: expand; reversible: true
-- ai_firewall 006: the labelled vectors (docs/phases/55-ai-firewall/03 §3.5; decision D55-88).
--
-- The feature store of 02 keeps an actor's windows in Redis for a day at most, so the vector a label is about is kept when it exists,
-- for the dataset export (03 §3.5) to join its labels to:
--
--   "ai_firewall_incidents"."peakVectors"  the behaviour.v1 and attack.v1 vectors of the incident's peak scoring (written by the incident
--                                          grouping with the scoring that set the peak, incidents/ai_firewall.incident-store.ts);
--   "ai_firewall_labels"."vectors"         the vectors of the labelled behaviour: an incident's peak vectors copied by the label's INSERT
--                                          (a person's verdict, the false alarm close), or the actor's vectors read when an event label
--                                          is produced (labels/ai_firewall.label-producer.ts).
--
-- Both are filled ONLY on an install whose INSTALL_ROLE is staging or demo (dataset/ai_firewall.vector-capture.ts); on a production
-- install they stay null. The value: {"v":1,"at":<ISO>,"coldStart":<bool>,"windowsRead":<bool>,"behaviour":{"catalogue","hash","values"},
-- "attack":{...}}, one number (or null for missing) per feature in the catalogue's order; numbers only, no actor, no name, no address.
-- They live and die with their rows (retention, purge); the erasure clears them on the erased person's incidents and their labels.
--
-- Additive: two nullable columns; the previous release neither reads nor writes them. In `synchronize` mode db:deploy's schema sync
-- applies them from the entities before this file runs; in `migrate` mode this file does. Names match the entities. Idempotent. RLS is
-- unchanged (001 and 004 cover both tables).
--
-- Down (exact reverse; NEVER auto-run): 006_ai_firewall_label_vectors.sql.down.

ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "peakVectors" jsonb;
ALTER TABLE "ai_firewall_labels" ADD COLUMN IF NOT EXISTS "vectors" jsonb;
