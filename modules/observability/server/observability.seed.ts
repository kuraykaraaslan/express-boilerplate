import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheck } from './entities/monitor_check.entity'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { Incident } from './entities/incident.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import { StatusComponent } from './entities/status_component.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import { StatusSubscriber } from './entities/status_subscriber.entity'
import { AlertRoute } from './entities/alert_route.entity'
import { SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'

/**
 * Uptime monitoring + status-page seed.
 *
 * Covers all four `MonitorType`s (HTTP/TCP/PING/DNS) and a spread of
 * `MonitorStatus`/`CheckStatus` values (UP/DOWN/DEGRADED/UNKNOWN) so the
 * monitors list, checks history and status-page components all render
 * non-trivially.
 *
 * `Monitor` has no `@Unique`, only an index — natural key for `foc` is
 * (`tenantId`, `name`), mirroring `audit_log`'s stable-composite-key
 * approach. `MonitorCheckDaily` and `StatusComponentMonitor` DO carry real
 * unique indexes, so `foc` uses them directly. `MonitorCheck` and
 * `IncidentUpdate` are append-only timelines with no natural key — guarded
 * with a `count() === 0` check per parent row, same pattern as
 * `coupon_redemption`'s log-table guard.
 */
export async function seedObservability(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx

  const now = Date.now()
  const minutesAgo = (n: number) => new Date(now - n * 60 * 1000)
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000)
  const utcDay = (d: Date) => d.toISOString().slice(0, 10)

  // ── Monitors ─────────────────────────────────────────────────────────────
  type MonitorDef = {
    name: string; type: 'HTTP' | 'TCP' | 'PING' | 'DNS'; target: string
    lastStatus: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN'
    consecutiveFailures?: number; consecutiveSuccesses?: number
    expectedStatus?: number; degradedLatencyMs?: number
  }

  const monitorDefs: MonitorDef[] = [
    { name: 'Web Sitesi', type: 'HTTP', target: 'https://www.example.com', lastStatus: 'UP', consecutiveSuccesses: 240, expectedStatus: 200, degradedLatencyMs: 800 },
    { name: 'API Ana Uç', type: 'HTTP', target: 'https://api.example.com/health', lastStatus: 'DEGRADED', consecutiveSuccesses: 12, expectedStatus: 200, degradedLatencyMs: 500 },
    { name: 'Veritabanı Bağlantısı', type: 'TCP', target: 'db.example.com:5432', lastStatus: 'UP', consecutiveSuccesses: 500 },
    { name: 'VPN Ağ Geçidi', type: 'PING', target: 'vpn.example.com', lastStatus: 'DOWN', consecutiveFailures: 6 },
    { name: 'Alan Adı Çözümleme', type: 'DNS', target: 'example.com', lastStatus: 'UNKNOWN' },
  ]

  const monitorRepo = ctx.repo<Monitor>(Monitor)
  const monitorsByName: Record<string, Monitor> = {}
  for (const def of monitorDefs) {
    monitorsByName[def.name] = await foc(monitorRepo,
      { tenantId, name: def.name } as FindOptionsWhere<Monitor>,
      {
        tenantId, name: def.name, type: def.type, target: def.target,
        intervalSeconds: 60, timeoutMs: 10000,
        expectedStatus: def.expectedStatus ?? null,
        degradedLatencyMs: def.degradedLatencyMs ?? null,
        isActive: true, consecutiveFailThreshold: 3,
        lastStatus: def.lastStatus,
        consecutiveFailures: def.consecutiveFailures ?? 0,
        consecutiveSuccesses: def.consecutiveSuccesses ?? 0,
        lastCheckedAt: minutesAgo(1),
      },
    )
  }

  // ── Monitor checks (raw samples, last few hours) ────────────────────────
  const checkRepo = ctx.repo<MonitorCheck>(MonitorCheck)
  const checkCount = await checkRepo.count({ where: { tenantId } })
  if (checkCount === 0) {
    const rows: Array<Partial<MonitorCheck> & { tenantId: string; monitorId: string; status: string; checkedAt: Date }> = []
    const sampleFor = (mon: Monitor, i: number): { status: 'UP' | 'DOWN' | 'DEGRADED'; latencyMs: number; statusCode?: number; error?: string } => {
      if (mon.lastStatus === 'DOWN') return { status: i < 3 ? 'DOWN' : 'UP', latencyMs: i < 3 ? 0 : 40, error: i < 3 ? 'Bağlantı zaman aşımına uğradı' : undefined }
      if (mon.lastStatus === 'DEGRADED') return { status: 'DEGRADED', latencyMs: 650, statusCode: mon.type === 'HTTP' ? 200 : undefined }
      return { status: 'UP', latencyMs: mon.type === 'HTTP' ? 120 : 20, statusCode: mon.type === 'HTTP' ? 200 : undefined }
    }
    for (const mon of Object.values(monitorsByName)) {
      for (let i = 0; i < 6; i++) {
        const s = sampleFor(mon, i)
        rows.push({
          tenantId, monitorId: mon.monitorId, status: s.status,
          latencyMs: s.latencyMs, statusCode: s.statusCode ?? null, error: s.error ?? null,
          duringMaintenance: false, checkedAt: minutesAgo((6 - i) * 10),
        })
      }
    }
    await checkRepo.save(rows.map((r) => checkRepo.create(r)))
    ctx.log(`observability: ${rows.length} monitor checks for ${tenantId}`)
  }

  // ── Daily uptime rollups (last 3 days per monitor) ──────────────────────
  const dailyRepo = ctx.repo<MonitorCheckDaily>(MonitorCheckDaily)
  for (const mon of Object.values(monitorsByName)) {
    for (let d = 0; d < 3; d++) {
      const day = utcDay(daysAgo(d))
      const down = mon.lastStatus === 'DOWN' && d === 0 ? 40 : 0
      const degraded = mon.lastStatus === 'DEGRADED' ? 20 : 0
      const up = 1440 - down - degraded
      await foc(dailyRepo,
        { tenantId, monitorId: mon.monitorId, day } as FindOptionsWhere<MonitorCheckDaily>,
        { tenantId, monitorId: mon.monitorId, day, up, degraded, down },
      )
    }
  }

  // ── Status components (customer-facing) + links ─────────────────────────
  const componentRepo = ctx.repo<StatusComponent>(StatusComponent)
  type ComponentDef = { name: string; description: string; order: number; status: string; monitorNames: string[] }
  const componentDefs: ComponentDef[] = [
    { name: 'Web Sitesi', description: 'Genel web sitesi erişilebilirliği.', order: 1, status: 'OPERATIONAL', monitorNames: ['Web Sitesi'] },
    { name: 'API', description: 'Genel API erişilebilirliği.', order: 2, status: 'DEGRADED', monitorNames: ['API Ana Uç'] },
    { name: 'Ağ Bağlantısı', description: 'Kurumsal VPN ve ağ altyapısı.', order: 3, status: 'MAJOR_OUTAGE', monitorNames: ['VPN Ağ Geçidi'] },
  ]

  const componentMonitorRepo = ctx.repo<StatusComponentMonitor>(StatusComponentMonitor)
  for (const def of componentDefs) {
    const component = await foc(componentRepo,
      { tenantId, name: def.name } as FindOptionsWhere<StatusComponent>,
      { tenantId, name: def.name, description: def.description, order: def.order, isPublic: true, status: def.status },
    )
    for (const monName of def.monitorNames) {
      const mon = monitorsByName[monName]
      if (!mon) continue
      await foc(componentMonitorRepo,
        { tenantId, componentId: component.componentId, monitorId: mon.monitorId } as FindOptionsWhere<StatusComponentMonitor>,
        { tenantId, componentId: component.componentId, monitorId: mon.monitorId },
      )
    }
  }

  // ── Incidents (one resolved auto, one open manual+public) ───────────────
  const incidentRepo = ctx.repo<Incident>(Incident)
  const vpnMonitor = monitorsByName['VPN Ağ Geçidi']
  const apiMonitor = monitorsByName['API Ana Uç']

  const openIncident = await foc(incidentRepo,
    { tenantId, monitorId: vpnMonitor.monitorId, status: 'OPEN' } as FindOptionsWhere<Incident>,
    {
      tenantId, monitorId: vpnMonitor.monitorId, title: 'VPN ağ geçidine erişilemiyor',
      status: 'OPEN', severity: 'CRITICAL', isAuto: true, isPublic: true,
      publicMessage: 'Ağ bağlantısında sorun tespit edildi, ekibimiz araştırıyor.',
      reason: 'Ping probu 6 ardışık denemede zaman aşımına uğradı.',
      startedAt: minutesAgo(35),
    },
  )

  const resolvedIncident = await foc(incidentRepo,
    { tenantId, title: 'API gecikmesi (çözüldü)' } as FindOptionsWhere<Incident>,
    {
      tenantId, monitorId: apiMonitor.monitorId, title: 'API gecikmesi (çözüldü)',
      status: 'RESOLVED', severity: 'MINOR', isAuto: false, isPublic: true,
      publicMessage: 'API yanıt sürelerindeki artış giderildi.',
      reason: 'Veritabanı bağlantı havuzu doygunluğu.',
      startedAt: daysAgo(2), resolvedAt: daysAgo(2 - 0.1),
    },
  )

  // ── Incident updates (public progress steps) ────────────────────────────
  const updateRepo = ctx.repo<IncidentUpdate>(IncidentUpdate)
  const updateCount = await updateRepo.count({ where: { tenantId } })
  if (updateCount === 0) {
    const rows = [
      { incidentId: openIncident.incidentId, status: 'INVESTIGATING', publicMessage: 'Ağ bağlantısı sorunu tespit edildi, araştırılıyor.', createdAt: minutesAgo(35) },
      { incidentId: openIncident.incidentId, status: 'IDENTIFIED', publicMessage: 'Sorunun kaynağı VPN ağ geçidi olarak belirlendi.', createdAt: minutesAgo(20) },
      { incidentId: resolvedIncident.incidentId, status: 'INVESTIGATING', publicMessage: 'API yanıt sürelerinde artış gözlemlendi.', createdAt: daysAgo(2) },
      { incidentId: resolvedIncident.incidentId, status: 'MONITORING', publicMessage: 'Düzeltme uygulandı, izleniyor.', createdAt: daysAgo(2 - 0.05) },
      { incidentId: resolvedIncident.incidentId, status: 'RESOLVED', publicMessage: 'Sorun tamamen giderildi.', createdAt: daysAgo(2 - 0.1) },
    ]
    await updateRepo.save(rows.map((r) => updateRepo.create({ tenantId, ...r })))
    ctx.log(`observability: ${rows.length} incident updates for ${tenantId}`)
  }

  // ── Status subscribers ───────────────────────────────────────────────────
  const subscriberRepo = ctx.repo<StatusSubscriber>(StatusSubscriber)
  const subscriberDefs = [
    { email: 'operasyon@example.com', verifiedAt: daysAgo(30), verifyToken: null, unsubscribeToken: 'unsub-tok-0001' },
    { email: 'yatirimci@example.com', verifiedAt: null, verifyToken: 'verify-tok-0002', unsubscribeToken: 'unsub-tok-0002' },
  ]
  for (const def of subscriberDefs) {
    await foc(subscriberRepo,
      { tenantId, email: def.email } as FindOptionsWhere<StatusSubscriber>,
      { tenantId, email: def.email, verifiedAt: def.verifiedAt, componentIds: null, verifyToken: def.verifyToken, unsubscribeToken: def.unsubscribeToken },
    )
  }

  // ── The default Security alert route (38-security 3.8 leftover, phase 55 00.4) ─────────────────────────
  // audit_log's security alert rules (`observability:alert-source`) label every alert `category=security`; without a route that claims
  // them they only reach the built-in default. First in order and `continueMatching`, so a critical one still reaches the on-call
  // routes behind it. It tells the seeded admin; a tenant edits it like any other route. Demo data only: production tenants get no
  // route yet, because a notify target can name users or addresses but not "the workspace's owners" (see the phase 55 00 status).
  const adminUserId = (ctx.refs.adminUserId as string | undefined) ?? SEED_ADMIN_USER_ID
  const routeRepo = ctx.repo<AlertRoute>(AlertRoute)
  await foc(routeRepo,
    { tenantId, name: SECURITY_ROUTE_NAME } as FindOptionsWhere<AlertRoute>,
    {
      tenantId, name: SECURITY_ROUTE_NAME, position: 0,
      matchers: [{ label: 'category', op: '=', value: 'security' }],
      groupBy: ['rule'], groupWaitSeconds: 30, groupIntervalSeconds: 300,
      targets: [{ type: 'notify', userIds: [adminUserId], urgency: 'CRITICAL' }],
      incident: null, continueMatching: true, enabled: true, managedBy: null, sourceKey: null,
    },
  )
  ctx.log(`observability: the ${SECURITY_ROUTE_NAME} alert route for ${tenantId}`)

  ctx.log(`observability: ${monitorDefs.length} monitors, ${componentDefs.length} status components, 2 incidents, ${subscriberDefs.length} subscribers for ${tenantId}`)
}

/** The name of the seeded route that claims the security alert rules' alerts (label `category=security`). */
export const SECURITY_ROUTE_NAME = 'Security'
