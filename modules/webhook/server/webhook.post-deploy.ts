import type { PostDeployStep } from '@kuraykaraaslan-labs/db/server/db.post-deploy'
import { describeEncryptedColumnsReport, encryptPlaintextColumns, systemBatchesOn, type EncryptedColumnTable } from '@kuraykaraaslan-labs/db/server/db.encrypted-columns'

/** The signing secrets of `webhooks`, field-encrypted at rest (P9-6; the entity's `encryptedColumnTransformer`). */
export const WEBHOOK_SECRET_COLUMNS: EncryptedColumnTable = { table: 'webhooks', idColumn: 'webhookId', columns: ['secret', 'previousSecret'] }

/**
 * `db:post_deploy` step (P9-6): encrypt the signing secrets stored before the column was encrypted. Every new write is encrypted by the
 * entity transformer and old rows are read as they are, so this only converts the backlog; idempotent (an envelope is never touched), batched,
 * guarded on the value read, counts only in the log. Without SETTINGS_ENCRYPTION_KEY it does nothing and says so.
 */
const step: PostDeployStep = {
  async run(ctx) {
    return describeEncryptedColumnsReport(await encryptPlaintextColumns(systemBatchesOn(ctx.dataSource), WEBHOOK_SECRET_COLUMNS))
  },
}

export default step
