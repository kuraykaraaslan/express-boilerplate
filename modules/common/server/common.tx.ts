import type { DataSource, EntityManager } from 'typeorm'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from './app-error'

/**
 * Threading one transaction through several modules' writes.
 *
 * ## Why this is here rather than in each module
 *
 * Four modules had written this identical function — `contact`,
 * `crm_opportunity`, `tags`, `activity` — and two of them kept it file-local,
 * which is why the count reached four while a note in the CRM plan still said
 * three: a local copy does not show up when you grep for the export. The
 * function is eleven lines and the copies were byte-identical apart from the
 * module name in the log line, so every copy was a chance for one of them to
 * drift on the ONE thing it decides, which is a correctness rule about which
 * connection a write lands on.
 *
 * ## The identity check is the whole point
 *
 * A tenant's writes all share `tenantDataSourceFor(tenantId)`, so passing a
 * manager between modules is safe WITHIN a tenant — `crm_lead.convert` creating
 * a company, a contact and an opportunity atomically is exactly what it is for.
 * A manager belonging to ANOTHER tenant's DataSource is a different matter: the
 * write would go to a different connection, outside the caller's transaction
 * and outside its rollback, and nothing would report it. So the mismatch is
 * detected, logged loudly, and the module's own `ds` is used instead.
 *
 * Falling back rather than throwing is deliberate: the caller's intent — write
 * this row — is still honourable, and refusing the whole operation because a
 * caller threaded the wrong handle would turn a recoverable mistake into an
 * outage. The log line names the module, which is what makes it findable.
 */
export interface TxOptions {
  manager?: EntityManager
}

export type EntitySource = DataSource | EntityManager

/**
 * Build a module's `entitySourceFor`.
 *
 * A factory rather than a three-argument function so that every existing call
 * site — `entitySourceFor(ds, opts)`, hundreds of them — keeps working
 * unchanged, and the module name is stated once where the binding is made.
 */
export function makeEntitySource(moduleId: string) {
  return function entitySourceFor(ds: DataSource, opts?: TxOptions): EntitySource {
    if (!opts?.manager) return ds
    if (opts.manager.connection !== ds) {
      // common.26 (decided 2026-10-20): a manager of ANOTHER data source (another tenant's database) is refused. Falling back
      // to the tenant connection silently split one logical transaction in two: the caller believed its write was atomic
      // with its own, and it was not.
      Logger.error(`[${moduleId}] manager from a foreign DataSource refused`)
      throw new AppError('A transaction manager of another data source was passed', 500, ErrorCode.INTERNAL_ERROR)
    }
    return opts.manager
  }
}
