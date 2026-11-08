import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { AlertDependency } from './entities/alert_dependency.entity'
import AlertService from './alert.service'
import { wouldCycle } from './alert.inhibit'
import type { CreateDependencyInput } from './alert.dto'
import { assertEditable } from './config/config.managed'

const MAX_EDGES = 500

/** The dependency graph behind inhibition (observability phase 11). A cycle is refused when written, so a bad graph cannot be saved. */
export default class AlertDependencyService {
  static async list(tenantId: string): Promise<AlertDependency[]> {
    return withTenantRepositoryFor(tenantId, AlertDependency, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' }, take: MAX_EDGES }))
  }

  static async create(tenantId: string, input: CreateDependencyInput, managed?: { managedBy: string }): Promise<AlertDependency> {
    const edges = await AlertDependencyService.list(tenantId)
    if (edges.length >= MAX_EDGES) throw new AppError(`At most ${MAX_EDGES} dependencies`, 409, ErrorCode.CONFLICT)
    if (edges.some((e) => e.child === input.child && e.parent === input.parent)) throw new AppError('That dependency already exists', 409, ErrorCode.CONFLICT)
    if (wouldCycle(edges, input.child, input.parent)) throw new AppError('That dependency would create a loop', 409, ErrorCode.CONFLICT)
    const row = await withTenantRepositoryFor(tenantId, AlertDependency, (repo) => repo.save(repo.create({ tenantId, child: input.child, parent: input.parent, ...(managed ? { managedBy: managed.managedBy } : {}) })))
    await AlertService.reevaluate(tenantId)
    return row
  }

  static async remove(tenantId: string, dependencyId: string): Promise<void> {
    assertEditable(await withTenantRepositoryFor(tenantId, AlertDependency, (repo) => repo.findOne({ where: { tenantId, dependencyId } })), 'alert dependency')
    const r = await withTenantRepositoryFor(tenantId, AlertDependency, (repo) => repo.delete({ tenantId, dependencyId }))
    if (!r.affected) throw new AppError('Dependency not found', 404, ErrorCode.NOT_FOUND)
    await AlertService.reevaluate(tenantId)
  }
}
