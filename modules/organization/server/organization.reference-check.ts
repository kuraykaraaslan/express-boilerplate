// Referential-integrity seam for the organization master data.
//
// A legal entity / site / cost center is pointed at by rows this module cannot
// see: hr's employees and departments, accounting's journal lines, inventory's
// stock items, procurement's orders. `organization` must not import any of them
// — it is the BASE of the ERP graph (`requires: []`), and every consumer
// requires it, so an `organization -> consumer` import makes `findCycle` in the
// registry snapshot fail the build.
//
// So the arrow is inverted: `organization` declares
// `organization:reference_check`, each owner of referencing data contributes a
// counter, and a delete asks every contributor first. The point is a data-gate
// guard: a satellite is asked whatever its state while its rows exist (a
// disabled hr still blocks the delete of a site its employees work at), and
// one that throws or times out BLOCKS the delete rather than being skipped
// (EXT-3). A satellite that is absent (not in this build) contributes nothing
// — the delete proceeds, exactly as it would have before that satellite
// existed. Server-only; kept React-free.

import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { organizationReferenceCheckLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/organization.reference_check'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import type { OrganizationRefKind } from './organization.enums'
import type { OrganizationRef, OrganizationReferenceHit } from './organization.types'
import { referenceUnverifiableMessage, stillReferencedMessage } from './organization.messages'

/** Extension point id — declared in organization/module.json `extensionPoints`. */
export const ORGANIZATION_REFERENCE_CHECK_POINT = 'organization:reference_check'

/**
 * A contribution to `organization:reference_check`.
 *
 * Returns `null` (or a zero `count`) when the contributing module holds no live
 * rows pointing at `ref`, otherwise `{ moduleId, count, label }` where `label`
 * names the referencing rows in the plural ("employees", "journal lines").
 * Must be cheap: it runs on the delete path for every row.
 */
export type OrganizationReferenceCheck = (
  tenantId: string,
  ref: { kind: OrganizationRefKind; id: string },
) => Promise<OrganizationReferenceHit | null>

/** What a delete learns about `ref`: the referencing rows, and who could not be asked. */
export interface OrganizationReferenceReport {
  /** Modules reporting a non-zero count, in registry order. */
  hits: OrganizationReferenceHit[]
  /** Modules that threw or timed out, so whether they reference `ref` is unknown. */
  unverifiable: string[]
}

/**
 * Ask every registered contribution about `ref`.
 *
 * Contributions run concurrently through the host runtime. This used to fail
 * OPEN — a failing contribution was logged and skipped so a broken satellite
 * could not make the master data undeletable, but a delete could then orphan
 * that satellite's rows (organization.02). It now fails CLOSED (EXT-3): a
 * module that could not answer is listed in `unverifiable` and the delete
 * guard refuses.
 */
export async function collectReferences(
  tenantId: string,
  ref: OrganizationRef,
): Promise<OrganizationReferenceReport> {
  const { results, unverifiable } = await ext.guard<OrganizationReferenceCheck, OrganizationReferenceHit | null>(
    ORGANIZATION_REFERENCE_CHECK_POINT,
    tenantCtx(tenantId),
    organizationReferenceCheckLoaders,
    (check) => check(tenantId, ref),
  )
  return {
    hits: results.map((r) => r.value).filter((hit): hit is OrganizationReferenceHit => !!hit && hit.count > 0),
    unverifiable: [...new Set(unverifiable.map((f) => f.moduleId))],
  }
}

/**
 * Delete guard: throws 409 naming the first module that still references `ref`
 * and how many rows it holds, or — when nothing is known to reference it but a
 * module could not be asked — 409 naming the module that could not be
 * verified. Every service calls this before `softRemove`, so "delete a site 12
 * employees work at" fails loudly instead of silently orphaning those
 * employees.
 */
export async function assertNotReferenced(
  tenantId: string,
  ref: OrganizationRef,
): Promise<void> {
  const { hits, unverifiable } = await collectReferences(tenantId, ref)
  if (hits.length > 0) {
    const first = hits[0]
    throw new AppError(
      stillReferencedMessage(first.moduleId, first.count, first.label),
      409,
      ErrorCode.CONFLICT,
    )
  }
  if (unverifiable.length > 0) {
    throw new AppError(referenceUnverifiableMessage(unverifiable), 409, ErrorCode.CONFLICT)
  }
}
