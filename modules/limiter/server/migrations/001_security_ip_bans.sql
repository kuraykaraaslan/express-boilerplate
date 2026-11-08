-- kind: expand; reversible: true
-- limiter 001: the `security_ip_bans` table, the durable copy of the address bans (docs/phases/55-ai-firewall 00 §0.2, P-2).
--
-- Redis keeps the hot copy the proxy reads on every request (`ip-ban:<target>`); this table keeps every ban that must outlive a Redis
-- flush (every manual and firewall ban, every automatic ban longer than an hour), and the limiter rebuilds the Redis keys from it after
-- a flush (limiter.ip-ban-store.ts `rebuildIfFlushed`). One row per ban: a lift sets "liftedAt" / "liftedBy", a newer ban on the same
-- target lifts the older row.
--
-- Installation-wide ROOT data with no tenant column: RLS-exempt (modules/db/scripts/rls-exempt.ts gives the reason), so no policy pair
-- here and none from the generated tenant 127. Only the limiter reads and writes it.
--
-- In `synchronize` mode db:deploy's schema-sync phase creates the table from the entity (server/entities/security_ip_ban.entity.ts)
-- before this file runs; in `migrate` mode this file creates it. Column types, defaults and every constraint and index name match the
-- entity, so neither mode fights the other. Purely additive: the previous release neither reads nor minds it. Idempotent.
--
-- Down (exact reverse; nothing else depends on the table):
--   DROP TABLE IF EXISTS "security_ip_bans";

CREATE TABLE IF NOT EXISTS "security_ip_bans" (
  "banId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "target" character varying(64) NOT NULL,
  "kind" character varying(8) NOT NULL,
  "reason" character varying(200) NOT NULL,
  "source" character varying(16) NOT NULL,
  "offense" integer NOT NULL DEFAULT 1,
  "actorId" uuid,
  "bannedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "liftedAt" TIMESTAMP WITH TIME ZONE,
  "liftedBy" uuid,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_security_ip_bans" PRIMARY KEY ("banId")
);
CREATE INDEX IF NOT EXISTS "IDX_security_ip_bans_target" ON "security_ip_bans" ("target");
CREATE INDEX IF NOT EXISTS "IDX_security_ip_bans_expires" ON "security_ip_bans" ("expiresAt");
