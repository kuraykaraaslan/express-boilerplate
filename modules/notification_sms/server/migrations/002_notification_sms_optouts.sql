-- kind: expand; reversible: true
-- notification_sms 002: the durable SMS opt-out (STOP) list (docs/audits/2026-11-03-redis-outage.md §6.7 item 2, decision D254).
--
--   "notification_sms_optouts"   one row per (tenant, recipient number in E.164): "optedOut" true after a STOP, false after the START that took it
--                                back, the keyword and when it was set. Written by every STOP / START before anything else; the send path reads it
--                                as the source of truth (Redis caches it). Before this table the list lived in a Redis set only, and a Redis that
--                                lost its data forgot every opt-out. The number is personal data: stored canonical (E.164), deleted with the
--                                tenant by the purge step, kept on a subject's erasure as the record of the objection (module.json, RETAIN).
--
-- In `synchronize` mode db:deploy's schema sync creates the table from entities/notification_sms_optout.entity.ts before this file runs; in
-- `migrate` mode this file creates it. Column types, defaults, constraint names match the entity. Tenant table: the tenant_isolation /
-- tenant_admin_bypass pair of tenant migration 127 (db.rls-policy.ts) and ROW LEVEL SECURITY FORCED FROM BIRTH. Purely additive and idempotent.

CREATE TABLE IF NOT EXISTS "notification_sms_optouts" (
  "tenantId" uuid NOT NULL,
  "phone" character varying(16) NOT NULL,
  "optedOut" boolean NOT NULL,
  "keyword" character varying(16) NOT NULL,
  "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_notification_sms_optouts" PRIMARY KEY ("tenantId", "phone")
);

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE ───────────────────────────────────────────

ALTER TABLE "notification_sms_optouts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notification_sms_optouts";
DROP POLICY IF EXISTS tenant_admin_bypass ON "notification_sms_optouts";
CREATE POLICY tenant_isolation ON "notification_sms_optouts"
  USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "notification_sms_optouts" TO app_admin
  USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()));
ALTER TABLE "notification_sms_optouts" FORCE ROW LEVEL SECURITY;
