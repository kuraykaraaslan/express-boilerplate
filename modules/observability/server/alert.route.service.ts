import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { AlertRoute } from './entities/alert_route.entity'
import AlertService from './alert.service'
import type { CreateRouteInput, SimulateRouteInput, UpdateRouteInput } from './alert.dto'
import { assertEditable } from './config/config.managed'

/** Routing rules (observability phase 11): CRUD plus the simulator, which asks the pipeline's own `decide` and writes nothing. */
export default class AlertRouteService {
  static async list(tenantId: string): Promise<AlertRoute[]> {
    return withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.find({ where: { tenantId }, order: { position: 'ASC' } }))
  }

  static async create(tenantId: string, input: CreateRouteInput, managed?: { managedBy: string; sourceKey: string | null }): Promise<AlertRoute> {
    const existing = await AlertRouteService.list(tenantId)
    const position = input.position ?? (existing.length ? Math.max(...existing.map((r) => r.position)) + 1 : 0)
    return withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.save(repo.create({
      tenantId, name: input.name, position, matchers: input.matchers, groupBy: input.groupBy,
      groupWaitSeconds: input.groupWaitSeconds, groupIntervalSeconds: input.groupIntervalSeconds, targets: input.targets,
      incident: input.incident ?? null, continueMatching: input.continueMatching, enabled: input.enabled,
      ...(managed ? { managedBy: managed.managedBy, sourceKey: managed.sourceKey } : {}),
    })))
  }

  static async update(tenantId: string, routeId: string, input: UpdateRouteInput): Promise<AlertRoute> {
    const row = await withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.findOne({ where: { tenantId, routeId } }))
    if (!row) throw new AppError('Route not found', 404, ErrorCode.NOT_FOUND)
    assertEditable(row, 'alert route')
    Object.assign(row, input)
    return withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.save(row))
  }

  static async remove(tenantId: string, routeId: string): Promise<void> {
    assertEditable(await withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.findOne({ where: { tenantId, routeId } })), 'alert route')
    const r = await withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.delete({ tenantId, routeId }))
    if (!r.affected) throw new AppError('Route not found', 404, ErrorCode.NOT_FOUND)
  }

  /** "Where would an alert with these labels go?" Same decision, no write. */
  static async simulate(tenantId: string, input: SimulateRouteInput) {
    return AlertService.explain(tenantId, { labels: input.labels, severity: input.severity, source: input.source })
  }
}
