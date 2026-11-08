import 'reflect-metadata'
import { In, type QueryRunner } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { DashboardCardOverlay } from './entities/dashboard_card_overlay.entity'

/**
 * Deleting card overlays with the cards and boards they belong to (phase 38, E38-12). Kept apart from the overlay service so the board
 * removal and the module purge sweep need only the table, not the card save path.
 */

/** A board's overlays, on the caller's transaction (the board is being deleted). */
export async function deleteOverlaysForBoard(qr: QueryRunner, tenantId: string, boardId: string): Promise<void> {
  await qr.manager.getRepository(DashboardCardOverlay).delete({ tenantId, boardId })
}

/** Some cards' overlays (the cards are being deleted). */
export async function deleteOverlaysForCards(tenantId: string, instanceIds: readonly string[]): Promise<void> {
  if (instanceIds.length === 0) return
  await withTenantRepositoryFor(tenantId, DashboardCardOverlay, (repo) => repo.delete({ tenantId, instanceId: In([...instanceIds]) }))
}
