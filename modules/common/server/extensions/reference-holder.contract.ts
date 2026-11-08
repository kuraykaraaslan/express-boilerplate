/**
 * The contract of `module_lifecycle:reference_holder` (docs/phases/37-extensions/06), kept in common so a module can
 * hold references, and be asked about them, without importing module_lifecycle (EXT-14: contributing is not depending;
 * 35-editions keeps contracts where every edition has them). module_lifecycle re-exports it.
 */

export interface HeldReferences {
  /** What the references are, in the holder's words ("automation flows", "dashboard boards"). */
  label: string;
  count: number;
  /** A few of them, for the preview and the orphan report. */
  sample?: Array<{ id: string; title: string; href?: string }>;
}

/** What a `module_lifecycle:reference_holder` contribution default-exports. */
export interface ReferenceHolder {
  listReferences(tenantId: string, moduleId: string): Promise<HeldReferences>;
  /** Delete or reset the references; called when the module's data is purged. Returns how many it removed. */
  sweep(tenantId: string, moduleId: string): Promise<{ removed: number }>;
}
