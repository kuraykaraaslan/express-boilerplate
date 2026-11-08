-- kind: expand
-- 067 — Slack and Teams subscribers of a status page
-- (docs/phases/09-observability/15-status-page-v2.md item 15.5, respond track).
--
-- Three nullable columns on `status_subscribers` for the SLACK and TEAMS channels: the incoming-webhook URL ENCRYPTED (`chatUrlCipher`; the URL is
-- the credential for the channel, so unlike `endpointUrl` it is never kept in the clear), its host for the operator's screen (`chatUrlHost`) and a
-- per-tenant fingerprint (`chatUrlFingerprint`) behind a partial unique index, so "already subscribed" is decided without the URL. `channel` is the
-- existing varchar(8) and simply gains the values SLACK and TEAMS; no existing row changes.
--
-- The statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool), made idempotent with IF NOT EXISTS so a
-- database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.
--
-- DOWN (the exact reverse; subscribers of the two new channels are lost, email, SMS and webhook subscribers are untouched):
--   DROP INDEX IF EXISTS "uq_status_subscriber_chat";
--   ALTER TABLE "status_subscribers" DROP COLUMN IF EXISTS "chatUrlCipher", DROP COLUMN IF EXISTS "chatUrlHost", DROP COLUMN IF EXISTS "chatUrlFingerprint";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'status_subscribers'
  ) THEN
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "chatUrlCipher" text;
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "chatUrlHost" character varying(253);
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "chatUrlFingerprint" character varying(64);
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_subscriber_chat" ON "status_subscribers" ("tenantId", "chatUrlFingerprint") WHERE "chatUrlFingerprint" IS NOT NULL;
  END IF;
END $$;
