// The privacy contract: what a module needs to know to contribute to a dossier (ACCESS/PORTABILITY) or an erasure.
// Lives in `common` so that a Core or Pro module can contribute without depending on `privacy` (an Enterprise module).
// `privacy` re-exports these from its old paths, so importing from `privacy` keeps working; contributors import from here.

/**
 * The subject a request is about.
 *
 * `subjectType`/`subjectId` is the polymorphic seam; `identifiers` carries the
 * other handles a module might key on, because the same human is a `userId` to
 * one module, an email address to another and a `contactId` to a third. A
 * contributor matches on whichever it holds — that is what makes a dossier
 * complete rather than "complete for modules that store a userId".
 */
export interface PrivacySubject {
  subjectType: string
  subjectId: string
  identifiers: {
    userId?: string | null
    email?: string | null
    phone?: string | null
    /** Free-form extras: `{ contactId, employeeId, nationalId }`. */
    [key: string]: string | null | undefined
  }
}

/** One named group of rows in a dossier. Mirrors `ExportCollection` on purpose. */
export interface DossierSection {
  /**
   * Key in the dossier document. Namespace it with the module id
   * (`commerceReviews`, `hrEmployeeDocuments`) — the document is flat, and a
   * bare `records` from two modules collides.
   */
  key: string
  label: string
  rows: object[]
  /** Which lawful basis this data is held under, when the module knows. */
  legalBasis?: string
}

/**
 * What one module did with one subject's data.
 *
 * `ANONYMISE` is a first-class outcome, not a lesser `ERASE`: a review whose
 * author is detached still has to exist, or every product's rating silently
 * changes when one customer leaves.
 */
export interface ErasureOutcome {
  /**
   * Rows hard-deleted or irreversibly anonymised.
   *
   * In a preview (`dryRun`) this counts only rows that STILL carry the subject's
   * personal data and that an execution would delete or anonymise. A row this
   * provider already anonymised, tombstoned or redacted is no longer counted here
   * (it may still be counted in `retained`): privacy runs the same preview after
   * an executed erasure and treats anything above zero as residue
   * (P7-PRIVACY-REST, `verifyErasure`).
   */
  erased: number
  /** Rows deliberately kept. Requires `retainedReason`. */
  retained?: number
  /** Why they were kept — ideally citing a `privacy_retention_policies` row. */
  retainedReason?: string
  /**
   * What actually happened.
   *
   * `RETAIN` was added 2026-09-03 for a provider that erases NOTHING and says
   * why — `crm_opportunity` is the first. Before it, such a provider had to
   * claim `ANONYMISE` with `erased: 0`, which reads as "we anonymised nothing"
   * rather than "we hold this and here is the basis for keeping it". An
   * operator running a deletion needs to tell "nothing held here" from "held
   * and kept on purpose", and the difference is the whole value of the report.
   */
  mode?: 'ERASE' | 'ANONYMISE' | 'MIXED' | 'RETAIN'
}
