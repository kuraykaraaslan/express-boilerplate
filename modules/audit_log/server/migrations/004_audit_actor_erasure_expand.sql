-- kind: expand
-- audit_log 004: erasure of a sealed actor, step 1 of 2 - the tombstone (docs/phases/02-fleet/10-roadmap/02-phases-5-to-9.md, Phase 5, audit item 8).
--
-- Erasing an actor of a sealed chain is NOT deleting the mapping row: the mapping is also what stops a returning actor from becoming resolvable
-- again. The writer inserts a mapping with ON CONFLICT ("tenantId", "actorRef") DO NOTHING, so a DELETED row would be re-created with the real id by
-- the actor's next audit write, and every old row would resolve to the person again. The erased row therefore STAYS, with its actorId withdrawn:
--   "actorId"  now nullable; NULL means erased (the reader already turns a missing or null mapping into an unresolvable actor)
--   "erasedAt" when it was erased; NULL while the mapping is live
-- and a CHECK keeps the two in step. The function that performs the erasure is migration 005 (repeatable).
--
-- Additive for an N-1 application: it only ever writes a non-null actorId and reads a null one as "unresolvable", which is what it did for a
-- missing row. Mirrored in the entity (synchronize drops a CHECK the entity does not declare).

ALTER TABLE "audit_actor_identities" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "audit_actor_identities" ADD COLUMN IF NOT EXISTS "erasedAt" TIMESTAMP;

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'ck_audit_actor_identities_erased'
       AND c.conrelid = to_regclass(quote_ident(current_schema()) || '.audit_actor_identities')
  ) THEN
    ALTER TABLE "audit_actor_identities" ADD CONSTRAINT "ck_audit_actor_identities_erased" CHECK (("actorId" IS NULL) = ("erasedAt" IS NOT NULL));
  END IF;
END
$mig$;
