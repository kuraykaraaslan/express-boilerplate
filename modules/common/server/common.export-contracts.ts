// The tenant export contract: what a module returns to contribute collections to a tenant data export.
// Lives in `common` so that a Core or Pro module can contribute without depending on `tenant_export` (an Enterprise module).
// `tenant_export` re-exports these from its old path, so importing from it keeps working; contributors import from here.

/** One named collection in the export document. */
export interface ExportCollection {
  /**
   * The key this appears under in the export JSON. Namespace it with the module
   * id (`termsConsentAcceptances`, `invoiceLines`) — the document is flat, and
   * a bare `records` from two modules is a collision.
   */
  key: string;
  /** Human label for the manifest / compliance report. */
  label: string;
  rows: object[];
}

/** What a contributing module returns. Empty array = "nothing to export". */
export type ExportCollectionProvider = (
  tenantId: string,
  options: { redactPii: boolean },
) => Promise<ExportCollection[]>;
