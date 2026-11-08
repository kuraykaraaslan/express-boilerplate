-- module_lifecycle 002: the restore window of an uninstalled module (docs/phases/37-extensions/08, EXT-4).
--
-- An uninstall used to delete the module's tenant rows at once. Now it switches the module off and stamps the
-- ledger row: `uninstalledAt`, and `restorableUntil` (MODULE_RESTORE_WINDOW_DAYS later). Restoring inside the
-- window clears both and the data is still there; the daily purge job removes modules whose window has passed.
-- Numbered 002 so the module-governance set's 001 (branch fix/marketplace) applies before it after either merge.
-- Column types and names are TypeORM's for `@Column({ type: 'timestamp', nullable: true })`. Idempotent; the deploy
-- runner wraps each file in a transaction.

ALTER TABLE "installs" ADD COLUMN IF NOT EXISTS "uninstalledAt" TIMESTAMP NULL;
ALTER TABLE "installs" ADD COLUMN IF NOT EXISTS "restorableUntil" TIMESTAMP NULL;
