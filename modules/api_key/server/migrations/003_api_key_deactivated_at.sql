-- kind: expand; reversible: true
-- api_key 003: the key's deactivation stamp (2026-11-03; docs/phases/55-ai-firewall/01 §1.6, decision D55-16).
--
--   api_keys.deactivatedAt   when the key API's update last deactivated the key; cleared by its reactivation. Written only by that
--                            transition, never by the usage stamp of a verified request, which moves "updatedAt". The AI firewall's
--                            key revocation (api_key.revoke) records it, and its undo reactivates only the key that stamp still names.
--
-- Additive, nullable (null on every existing row: a key deactivated before this file is one no firewall run revoked). The previous
-- release neither reads nor writes it. Mirrors the entity. Idempotent. DOWN: 003_api_key_deactivated_at.sql.down.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP WITH TIME ZONE;
