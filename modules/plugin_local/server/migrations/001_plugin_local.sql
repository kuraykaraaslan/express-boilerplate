-- plugin_local 001: the two tables of the Core plugin source (uploaded plugin bundles and their versions).
--
-- The module shipped its entities without a SQL migration, so a node (which runs SQL migrations only) never got the tables and the
-- schema-drift check reported them missing. This file creates them exactly as the entities declare them. Operator-level tables: no
-- tenantId, so no row-level security. gen_random_uuid() (F26). Purely additive and idempotent: nothing reads these tables until the module
-- is installed, and every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "plugin_local_plugins" (
  "pluginId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "scopedName" character varying(120) NOT NULL,
  "name" character varying(200) NOT NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "currentVersionId" uuid,
  "createdBy" uuid,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_plugin_local_plugins_status" CHECK ("status" IN ('active', 'disabled')),
  CONSTRAINT "PK_ae497cfa56018b652fc17a274b0" PRIMARY KEY ("pluginId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_e987f177f5b680203359b5e22f" ON "plugin_local_plugins" ("scopedName");

CREATE TABLE IF NOT EXISTS "plugin_local_versions" (
  "versionId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "pluginId" uuid NOT NULL,
  "version" character varying(64) NOT NULL,
  "manifestJson" text NOT NULL,
  "sandboxJson" text,
  "bundleKey" character varying NOT NULL,
  "bundleUploadedFileId" uuid,
  "bundleSha256" character varying(64) NOT NULL,
  "signature" text,
  "signerKid" character varying(100),
  "signatureVerified" boolean NOT NULL DEFAULT false,
  "uploadedBy" uuid,
  "approvedBy" uuid,
  "approvedAt" TIMESTAMP,
  "yankedAt" TIMESTAMP,
  "yankedReason" text,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_1a2d255753c340c60ad581685f0" PRIMARY KEY ("versionId")
);
CREATE INDEX IF NOT EXISTS "IDX_6c55a697671380c6d77d66c8bb" ON "plugin_local_versions" ("pluginId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_plugin_local_versions_plugin_version" ON "plugin_local_versions" ("pluginId", "version");
