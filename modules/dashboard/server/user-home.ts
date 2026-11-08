import 'reflect-metadata'
import type { QueryRunner } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { DashboardUserHome } from './entities/dashboard_user_home.entity'

/**
 * A person's own home dashboard (phase 20.2e, `DashboardUserHome`). Only the table: who may choose which board (one they can open, a
 * standalone one) is the route's call, and which board a person lands on is `dashboard-landing.route.ts`'s. Kept light, so the board
 * removal and the module purge sweep need only the table.
 */

/** The board this person chose as their home, or null. */
export async function homeOf(tenantId: string, userId: string): Promise<string | null> {
  const row = await withTenantRepositoryFor(tenantId, DashboardUserHome, (repo) => repo.findOne({ where: { tenantId, userId } }))
  return row?.boardId ?? null
}

/** Makes `boardId` this person's home, replacing their earlier choice. */
export async function setHome(tenantId: string, userId: string, boardId: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, DashboardUserHome, async (repo) => {
    const row = await repo.findOne({ where: { tenantId, userId } })
    if (row) await repo.update({ homeId: row.homeId, tenantId }, { boardId })
    else await repo.insert({ tenantId, userId, boardId })
  })
}

/** This person has no home of their own again (the shared home, if any, is where they land). */
export async function clearHome(tenantId: string, userId: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, DashboardUserHome, (repo) => repo.delete({ tenantId, userId }))
}

/** Every person's pointer to a board, on the caller's transaction (the board is being deleted). */
export async function deleteHomesForBoard(qr: QueryRunner, tenantId: string, boardId: string): Promise<void> {
  await qr.manager.getRepository(DashboardUserHome).delete({ tenantId, boardId })
}
