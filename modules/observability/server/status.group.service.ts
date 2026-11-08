import 'reflect-metadata'
import { z } from 'zod'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { StatusComponentGroup } from './entities/status_component_group.entity'
import { StatusComponent } from './entities/status_component.entity'
import { publishStatusChanged } from './status.realtime'

/** Component groups (observability phase 15.2): one level, ordered, collapsible. Deleting a group ungroups its components; it deletes none. */

const MAX_GROUPS = 50

export const CreateStatusGroupDTO = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(500).nullish(),
  order: z.number().int().min(0).max(10000).optional(),
  collapsed: z.boolean().optional(),
})
export type CreateStatusGroupInput = z.infer<typeof CreateStatusGroupDTO>
export const UpdateStatusGroupDTO = patchSchema(CreateStatusGroupDTO)
export type UpdateStatusGroupInput = z.infer<typeof UpdateStatusGroupDTO>

export default class StatusGroupService {
  static async list(tenantId: string): Promise<StatusComponentGroup[]> {
    return withTenantRepositoryFor(tenantId, StatusComponentGroup, (repo) => repo.find({ where: { tenantId }, order: { order: 'ASC', createdAt: 'ASC' } }))
  }

  static async create(tenantId: string, input: CreateStatusGroupInput): Promise<StatusComponentGroup> {
    const count = await withTenantRepositoryFor(tenantId, StatusComponentGroup, (repo) => repo.count({ where: { tenantId } }))
    if (count >= MAX_GROUPS) throw new AppError(`At most ${MAX_GROUPS} groups`, 409, ErrorCode.QUOTA_EXCEEDED)
    const saved = await withTenantRepositoryFor(tenantId, StatusComponentGroup, (repo) => repo.save(repo.create({
      tenantId, name: input.name, description: input.description ?? null, order: input.order ?? 0, collapsed: input.collapsed ?? false,
    })))
    void publishStatusChanged(tenantId)
    return saved
  }

  static async update(tenantId: string, groupId: string, patch: UpdateStatusGroupInput): Promise<StatusComponentGroup> {
    const saved = await withTenantRepositoryFor(tenantId, StatusComponentGroup, async (repo) => {
      const row = await repo.findOne({ where: { tenantId, groupId } })
      if (!row) throw new AppError('Group not found', 404, ErrorCode.NOT_FOUND)
      const next = { ...patch } as Record<string, unknown>
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
      if (Object.keys(next).length) await repo.update({ tenantId, groupId }, next)
      return { ...row, ...next } as StatusComponentGroup
    })
    void publishStatusChanged(tenantId)
    return saved
  }

  static async remove(tenantId: string, groupId: string): Promise<void> {
    await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(StatusComponentGroup)
      const row = await repo.findOne({ where: { tenantId, groupId } })
      if (!row) throw new AppError('Group not found', 404, ErrorCode.NOT_FOUND)
      await qr.manager.getRepository(StatusComponent).update({ tenantId, groupId }, { groupId: null })
      await repo.delete({ tenantId, groupId })
    })
    void publishStatusChanged(tenantId)
  }

  /** Refuse a group id that is not this tenant's. null clears the group. */
  static async assertOwned(tenantId: string, groupId: string | null | undefined): Promise<void> {
    if (!groupId) return
    const n = await withTenantRepositoryFor(tenantId, StatusComponentGroup, (repo) => repo.count({ where: { tenantId, groupId } }))
    if (n === 0) throw new AppError('Group not found', 400, ErrorCode.VALIDATION_ERROR)
  }
}
