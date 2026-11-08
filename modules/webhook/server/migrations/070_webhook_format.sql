-- kind: expand
-- 070 — per-subscription body format (observability work order 2, item 8, decision D-OBS-11).
--
-- One additive column: `webhooks.format`, `json` (the platform's own envelope, the default: every existing endpoint keeps what it receives) or
-- `cloudevents` (a CloudEvents 1.0 event in structured content mode). Nothing existing changes.
--
-- Down (exact reverse; endpoints fall back to the platform envelope):
--   ALTER TABLE "webhooks" DROP COLUMN IF EXISTS "format";
--
-- The statement is the DDL TypeORM renders for the entity (scratch-schema tool), made idempotent with IF NOT EXISTS so a database that
-- `synchronize` already built is left alone.

ALTER TABLE "webhooks" ADD COLUMN IF NOT EXISTS "format" character varying(12) NOT NULL DEFAULT 'json';
