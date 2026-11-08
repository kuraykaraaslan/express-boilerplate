-- kind: expand; reversible: true
-- supersedes: 204774c3a0ee2b5942a22cca2cfa4b1ebc8fb19ca5602640876d97a2d9231065,52e7fc5d51b742ea35762c907ad7b9b17e64701a4bc3e944ca37bd58da1c4c3e,928d33a515760e64652d352d3facab44b9391b469a90416d8030a3192f58df1a,c7dc1faba60ffcaf96d9f88fa5ebceb16d3c9efa408c373348f001cd7410eb53
-- tenant 132: "tenants"."drTakenFromNodeId", the node this one last took the tenant over from in disaster recovery (decisions-2026-10-18.md F1).
--
-- A DR_STANDBY that executes node.failover (or a regional-operator order) takes over the tenants homed on the failed primary: it records itself as the
-- home, one assignment version higher, and stamps this column with the primary (tenant.dr.service.ts takeOverTenantsForDr). The primary's failback, run
-- on a database resynced from the standby, takes back exactly the tenants homed on the standby AND stamped with ITS id, and stamps the standby in
-- turn: a failback never takes a tenant the standby holds for any other reason (the directory applies the same rule to the receipts), and either
-- takeover recognises a repeat of itself (home = this node, stamp = the other node) to re-send receipts a lost delivery never brought to the directory.
--
-- Purely additive: a nullable column without a default, so the previous release keeps reading and writing "tenants" unchanged and a rollback leaves a
-- column it ignores. Type and name are the entity's. Idempotent, and a no-op while the table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "drTakenFromNodeId" VARCHAR(64);
END $$;
