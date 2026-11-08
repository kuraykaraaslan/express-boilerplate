-- kind: expand; reversible: true
-- api_key 001: the OWNER-marked service key (api_key.03, docs/phases/33-tests/29-open-defects).
--
--   api_keys.isServiceKey               a key an OWNER marked as the workspace's own integration: it keeps working after its creator leaves.
--                                       Every other key verifies only while its creator is an ACTIVE member of the tenant.
--   api_keys.serviceKeyMarkedByUserId   who marked it (audit).
--
-- Purely additive: the previous release neither reads nor writes these columns. Mirrors the entity. Idempotent.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "isServiceKey" boolean NOT NULL DEFAULT false;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "serviceKeyMarkedByUserId" uuid;
