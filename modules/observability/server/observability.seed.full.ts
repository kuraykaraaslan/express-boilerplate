import 'reflect-metadata'
import { createHash, randomBytes } from 'node:crypto'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheck } from './entities/monitor_check.entity'
import { MonitorCheckDetail } from './entities/monitor_check_detail.entity'
import { MonitorCheckDailyLocation } from './entities/monitor_check_daily_location.entity'
import { ProbeLocation } from './entities/probe_location.entity'
import { ProbeRunner } from './entities/probe_runner.entity'
import { ProbeEnrolment } from './entities/probe_enrolment.entity'
import { ProbeLease } from './entities/probe_lease.entity'
import { StatusComponentGroup } from './entities/status_component_group.entity'
import { StatusComponent } from './entities/status_component.entity'
import { StatusAutomation } from './entities/status_automation.entity'
import { StatusPage } from './entities/status_page.entity'
import { StatusTranslation } from './entities/status_translation.entity'
import { Incident } from './entities/incident.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import { IncidentEvent } from './entities/incident_event.entity'
import { IncidentParticipant } from './entities/incident_participant.entity'
import { IncidentPostmortem } from './entities/incident_postmortem.entity'
import { IncidentAiNote } from './entities/incident_ai_note.entity'
import { IncidentEmbedding } from './entities/incident_embedding.entity'
import { IncidentUpdateTemplate } from './entities/incident_update_template.entity'
import { Alert } from './entities/alert.entity'
import { AlertDependency } from './entities/alert_dependency.entity'
import { AlertIntegration } from './entities/alert_integration.entity'
import { AlertRoute } from './entities/alert_route.entity'
import { AlertSilence } from './entities/alert_silence.entity'
import { AlertSilenceTemplate } from './entities/alert_silence_template.entity'
import { ChatDestination } from './entities/chat_destination.entity'
import { Slo } from './entities/slo.entity'
import { ObservabilityReconciliation } from './entities/observability_reconciliation.entity'
import { emptyBuckets, bucketIndex } from './uptime.latency-buckets'

/**
 * The tenant that owns every row seeded here. SYNTHETIC: neither PLATFORM nor ACME, and in no
 * `tenants` table, so no real tenant's alert routing, paging, status page or probe fleet changes.
 */
export const SYNTHETIC_OBSERVABILITY_TENANT_ID = 'c0000000-0000-4000-8000-0000000000a2'

/** Synthetic people (no `users` row) and a synthetic on-call policy id (no row either). */
const PEOPLE = ['c0000000-0000-4000-8000-00000000a201', 'c0000000-0000-4000-8000-00000000a202', 'c0000000-0000-4000-8000-00000000a203', 'c0000000-0000-4000-8000-00000000a204']
const ON_CALL_POLICY_ID = 'c0000000-0000-4000-8000-00000000a2f1'

const DAY = 24 * 60 * 60 * 1000
const ANCHOR = Date.UTC(2026, 8, 1, 12, 0, 0)
const at = (days: number, minutes = 0) => new Date(ANCHOR + days * DAY + minutes * 60_000)
const utcDay = (d: Date) => d.toISOString().slice(0, 10)
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const SEED_META = { seed: true, synthetic: true }

/**
 * Full-load seed for `observability`: alerting (alerts, routes, silences, integrations,
 * dependencies), incident response (timeline, roles, post-mortems, AI notes, embeddings,
 * templates), status pages (pages, groups, automations, translations), SLOs, the private
 * probe fleet (locations, runners, enrolments, leases), per-location rollups, browser-check
 * details, chat destinations and the metering reconciliation — the 25 tables the default seed
 * leaves empty because each could route, page, publish or probe.
 *
 * How this stays harmless:
 *  - every row belongs to {@link SYNTHETIC_OBSERVABILITY_TENANT_ID};
 *  - monitors are inactive and target `.invalid` hosts; probe locations have no live runner;
 *  - alerts are already notified (or resolved) with no `dispatchAfter`, so the dispatcher never picks one;
 *  - SLOs raise no burn alerts; chat destinations are disabled or hold a non-decryptable placeholder;
 *  - secrets (integration keys, enrolment tokens, runner keys) are random hashes of nothing anyone holds.
 * Idempotent: every row is keyed on a name, a fixed date or a per-parent ordinal; dates are fixed.
 */
export async function seedObservabilityFull(ctx: SeedContext): Promise<void> {
  const { foc, faker } = ctx
  const tenantId = SYNTHETIC_OBSERVABILITY_TENANT_ID
  const T = { tenantId }
  const n: Record<string, number> = {}
  const bump = (k: string, by = 1) => { n[k] = (n[k] ?? 0) + by }

  // ── Monitors (inactive) and their samples ────────────────────────────────
  const monitorRepo = ctx.repo<Monitor>(Monitor)
  const monitorDefs = [
    { name: 'Synthetic web', type: 'HTTP', target: 'https://www.seed.example.invalid', lastStatus: 'UP' },
    { name: 'Synthetic API', type: 'HTTP', target: 'https://api.seed.example.invalid/health', lastStatus: 'DEGRADED' },
    { name: 'Synthetic database', type: 'TCP', target: 'db.seed.example.invalid:5432', lastStatus: 'DOWN' },
    { name: 'Synthetic checkout flow', type: 'BROWSER', target: 'https://shop.seed.example.invalid/checkout', lastStatus: 'UP' },
  ] as const
  const monitors: Monitor[] = []
  for (const d of monitorDefs) {
    monitors.push(await foc(monitorRepo, { tenantId, name: d.name } as FindOptionsWhere<Monitor>, {
      tenantId, name: d.name, type: d.type, target: d.target, intervalSeconds: 300, timeoutMs: 10000, isActive: false,
      consecutiveFailThreshold: 3, lastStatus: d.lastStatus, consecutiveFailures: d.lastStatus === 'DOWN' ? 4 : 0,
      consecutiveSuccesses: d.lastStatus === 'UP' ? 120 : 0, lastCheckedAt: at(-1), locations: ['seed-ist', 'seed-fra'],
    }))
  }

  // ── Private probe fleet ──────────────────────────────────────────────────
  const locationRepo = ctx.repo<ProbeLocation>(ProbeLocation)
  const locationDefs = [
    { key: 'seed-ist', label: 'Istanbul office', enabled: true, browserEnabled: true, publicVisible: true, publicLabel: 'Europe (Istanbul)' },
    { key: 'seed-fra', label: 'Frankfurt rack', enabled: true, browserEnabled: false, publicVisible: null, publicLabel: null },
    { key: 'seed-nyc', label: 'New York lab (retired)', enabled: false, browserEnabled: false, publicVisible: false, publicLabel: null },
  ]
  const locations: ProbeLocation[] = []
  for (const d of locationDefs) {
    locations.push(await foc(locationRepo, { tenantId, key: d.key } as FindOptionsWhere<ProbeLocation>, {
      tenantId, ...d, kind: 'PRIVATE', targetPolicy: { cidrs: ['192.0.2.0/24'], hostnames: ['*.seed.example.invalid'] },
      lastSeenAt: at(-2), version: '1.4.0',
    }))
  }
  const runnerRepo = ctx.repo<ProbeRunner>(ProbeRunner)
  const enrolRepo = ctx.repo<ProbeEnrolment>(ProbeEnrolment)
  const runners: ProbeRunner[] = []
  for (const [i, loc] of locations.entries()) {
    for (const k of [1, 2]) {
      const name = `${loc.key}-runner-${k}`
      // The key is a placeholder (not a parseable key); the fingerprint is random, so no runner can ever authenticate as it.
      runners.push(await foc(runnerRepo, { tenantId, name } as FindOptionsWhere<ProbeRunner>, {
        tenantId, locationId: loc.locationId, locationKey: loc.key, name,
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nseed-placeholder-not-a-key\n-----END PUBLIC KEY-----\n',
        fingerprint: randomBytes(32).toString('hex'), status: k === 2 && i === 2 ? 'REVOKED' : 'ACTIVE',
        version: k === 1 ? '1.4.0' : '1.3.2', lastSeenAt: at(-2 - i), revokedAt: k === 2 && i === 2 ? at(-20) : null,
        capabilities: loc.browserEnabled ? ['browser'] : null,
      }))
      bump('runners')
    }
    for (const [j, days] of [-40, -10].entries()) {
      const expiresAt = at(days)
      await foc(enrolRepo, { tenantId, locationId: loc.locationId, expiresAt } as FindOptionsWhere<ProbeEnrolment>, {
        tenantId, locationId: loc.locationId, locationKey: loc.key, tokenHash: sha256(randomBytes(32).toString('hex')),
        expiresAt, usedAt: j === 0 ? at(days - 1) : null, createdBy: PEOPLE[0],
      })
      bump('enrolments')
    }
  }

  const checkRepo = ctx.repo<MonitorCheck>(MonitorCheck)
  const detailRepo = ctx.repo<MonitorCheckDetail>(MonitorCheckDetail)
  const leaseRepo = ctx.repo<ProbeLease>(ProbeLease)
  const dailyLocRepo = ctx.repo<MonitorCheckDailyLocation>(MonitorCheckDailyLocation)
  const samples = Math.min(ctx.count(6), 60)
  for (const [mi, mon] of monitors.entries()) {
    for (let s = 0; s < samples; s++) {
      const loc = locations[s % 2]
      const checkedAt = at(-1, -s * 15)
      const status = mon.lastStatus === 'DOWN' && s < 4 ? 'DOWN' : mon.lastStatus === 'DEGRADED' && s % 3 === 0 ? 'DEGRADED' : 'UP'
      const latencyMs = status === 'DOWN' ? null : 80 + ((mi * 37 + s * 13) % 400)
      const check = await foc(checkRepo, { tenantId, monitorId: mon.monitorId, checkedAt } as FindOptionsWhere<MonitorCheck>, {
        tenantId, monitorId: mon.monitorId, status, latencyMs, statusCode: mon.type === 'HTTP' || mon.type === 'BROWSER' ? (status === 'DOWN' ? 503 : 200) : null,
        error: status === 'DOWN' ? 'connect ETIMEDOUT' : null, duringMaintenance: false, checkedAt, locationKey: loc.key,
      })
      bump('checks')
      if (mon.type === 'BROWSER') {
        await foc(detailRepo, { checkId: check.checkId } as FindOptionsWhere<MonitorCheckDetail>, {
          checkId: check.checkId, tenantId, monitorId: mon.monitorId, checkedAt,
          detail: { ...SEED_META, steps: [{ name: 'open', ms: 420 }, { name: 'add to cart', ms: 310 }, { name: 'pay', ms: 880 }], vitals: { lcp: 1800, cls: 0.02 } },
          screenshot: null, screenshotBytes: null, screenshotSha256: null, screenshotStep: null,
        })
        bump('details')
      }
      if (s < 3) {
        const runner = runners[(s % 2) * 2]
        const expiresAt = new Date(checkedAt.getTime() + 60_000)
        await foc(leaseRepo, { tenantId, monitorId: mon.monitorId, locationKey: loc.key, expiresAt } as FindOptionsWhere<ProbeLease>, {
          tenantId, monitorId: mon.monitorId, locationKey: loc.key, runnerId: runner.runnerId, expiresAt, completedAt: s === 2 ? null : checkedAt,
        })
        bump('leases')
      }
    }
    for (let d = 1; d <= 7; d++) {
      for (const loc of locations.slice(0, 2)) {
        const day = utcDay(at(-d))
        const down = mon.lastStatus === 'DOWN' && d === 1 ? 12 : 0
        const degraded = mon.lastStatus === 'DEGRADED' ? 30 : 0
        const up = 288 - down - degraded
        const buckets = emptyBuckets()
        const avg = 120 + mi * 40
        const idx = bucketIndex(avg)
        if (idx !== null) buckets[idx] = up + degraded
        await foc(dailyLocRepo, { tenantId, monitorId: mon.monitorId, locationKey: loc.key, day } as FindOptionsWhere<MonitorCheckDailyLocation>, {
          tenantId, monitorId: mon.monitorId, locationKey: loc.key, day, up, degraded, down,
          latencyCount: up + degraded, latencySumMs: String((up + degraded) * avg), latencyBuckets: buckets,
        })
        bump('dailyLocation')
      }
    }
  }

  // ── Status: groups, components, automations, pages ──────────────────────
  const groupRepo = ctx.repo<StatusComponentGroup>(StatusComponentGroup)
  const groups: StatusComponentGroup[] = []
  for (const [i, g] of [{ name: 'Customer-facing', description: 'What customers use directly.' }, { name: 'Infrastructure', description: 'Shared platform services.' }].entries()) {
    groups.push(await foc(groupRepo, { tenantId, name: g.name } as FindOptionsWhere<StatusComponentGroup>, { tenantId, ...g, order: i, collapsed: i === 1 }))
  }
  const componentRepo = ctx.repo<StatusComponent>(StatusComponent)
  const componentDefs = [
    { name: 'Website', status: 'OPERATIONAL', group: 0 },
    { name: 'Checkout', status: 'DEGRADED', group: 0 },
    { name: 'Public API', status: 'PARTIAL_OUTAGE', group: 0 },
    { name: 'Database', status: 'MAJOR_OUTAGE', group: 1 },
    { name: 'Background jobs', status: 'MAINTENANCE', group: 1 },
  ]
  const components: StatusComponent[] = []
  for (const [i, c] of componentDefs.entries()) {
    components.push(await foc(componentRepo, { tenantId, name: c.name } as FindOptionsWhere<StatusComponent>, {
      tenantId, name: c.name, description: `${c.name} availability.`, order: i, isPublic: i !== 4, status: c.status,
      groupId: groups[c.group].groupId, showUptime: true, showHistory: true, showRegions: i % 2 === 0, showResponseTime: i < 3,
    }))
  }
  const automationRepo = ctx.repo<StatusAutomation>(StatusAutomation)
  const minStatuses = ['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE']
  const sev = ['MINOR', 'MAJOR', 'CRITICAL']
  for (const [i, c] of components.slice(0, 4).entries()) {
    await foc(automationRepo, { tenantId, componentId: c.componentId } as FindOptionsWhere<StatusAutomation>, {
      tenantId, componentId: c.componentId, enabled: i !== 3, minStatus: minStatuses[i % 3], severity: sev[i % 3],
      postTitle: `${c.name} is having problems`, postMessage: `We are investigating issues with ${c.name}.`,
      resolveMessage: i % 2 ? null : `${c.name} has recovered.`, autoResolve: i !== 1, autoPublish: i === 0,
    })
    bump('automations')
  }
  const pageRepo = ctx.repo<StatusPage>(StatusPage)
  const pageDefs = [
    { slug: 'status', name: 'Service status', isDefault: true, enabled: true, audience: 'PUBLIC', theme: 'AUTO', languages: ['en', 'tr', 'de'], componentIds: null, ipAllowlist: null },
    { slug: 'partners', name: 'Partner status', isDefault: false, enabled: true, audience: 'AUTHENTICATED', theme: 'LIGHT', languages: ['en'], componentIds: components.slice(2, 4).map((c) => c.componentId), ipAllowlist: null },
    { slug: 'internal', name: 'Internal status', isDefault: false, enabled: false, audience: 'IP', theme: 'DARK', languages: null, componentIds: null, ipAllowlist: ['192.0.2.0/24', '198.51.100.7'] },
  ]
  const pages: StatusPage[] = []
  for (const p of pageDefs) {
    pages.push(await foc(pageRepo, { tenantId, slug: p.slug } as FindOptionsWhere<StatusPage>, {
      tenantId, ...p, domain: null, embedOrigins: null, snapshotEnabled: p.slug === 'status', snapshotAt: p.slug === 'status' ? at(-1) : null,
    }))
  }

  // ── Incidents and their response record ─────────────────────────────────
  const incidentRepo = ctx.repo<Incident>(Incident)
  const incidentDefs = [
    { title: 'Database primary unreachable', status: 'OPEN', severity: 'CRITICAL', monitor: 2, startDay: -1, isPublic: true },
    { title: 'Checkout slow for some customers', status: 'RESOLVED', severity: 'MAJOR', monitor: 1, startDay: -9, isPublic: true },
    { title: 'Background job backlog', status: 'RESOLVED', severity: 'MINOR', monitor: null, startDay: -30, isPublic: false },
  ] as const
  const incidents: Incident[] = []
  for (const d of incidentDefs) {
    const startedAt = at(d.startDay)
    incidents.push(await foc(incidentRepo, { tenantId, title: d.title } as FindOptionsWhere<Incident>, {
      tenantId, title: d.title, status: d.status, severity: d.severity, monitorId: d.monitor === null ? null : monitors[d.monitor].monitorId,
      isAuto: d.monitor !== null, isPublic: d.isPublic, publicMessage: d.isPublic ? `${d.title}. We are on it.` : null,
      affectedComponentIds: [components[d.monitor === null ? 4 : d.monitor === 2 ? 3 : 1].componentId], reason: 'Seeded scenario.',
      startedAt, resolvedAt: d.status === 'RESOLVED' ? new Date(startedAt.getTime() + 3 * 3600_000) : null,
      acknowledgedAt: new Date(startedAt.getTime() + 5 * 60_000), acknowledgedBy: PEOPLE[0],
      mitigatedAt: d.status === 'RESOLVED' ? new Date(startedAt.getTime() + 90 * 60_000) : null, declaredBy: PEOPLE[1],
      legalHold: false,
    }))
  }
  const updateRepo = ctx.repo<IncidentUpdate>(IncidentUpdate)
  const updates: IncidentUpdate[] = []
  const steps = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'] as const
  for (const inc of incidents) {
    const count = inc.status === 'RESOLVED' ? 4 : 2
    for (let k = 0; k < count; k++) {
      const createdAt = new Date(new Date(inc.startedAt).getTime() + k * 40 * 60_000)
      updates.push(await foc(updateRepo, { tenantId, incidentId: inc.incidentId, status: steps[k] } as FindOptionsWhere<IncidentUpdate>, {
        tenantId, incidentId: inc.incidentId, status: steps[k], publicMessage: `${steps[k].toLowerCase()}: ${inc.title}.`, createdAt,
      }))
    }
  }

  const eventRepo = ctx.repo<IncidentEvent>(IncidentEvent)
  const eventTypes = ['DECLARED', 'ALERT_LINKED', 'ACKNOWLEDGED', 'ROLE_ASSIGNED', 'SEVERITY_CHANGED', 'PUBLISHED', 'PUBLIC_UPDATE',
    'TASK_ADDED', 'NOTE_ADDED', 'AI_NOTE', 'MITIGATED', 'ROLE_REMOVED', 'UNPUBLISHED', 'POSTMORTEM', 'RESOLVED']
  for (const [ii, inc] of incidents.entries()) {
    const types = inc.status === 'OPEN' ? eventTypes.slice(0, 10) : eventTypes
    for (const [k, type] of types.entries()) {
      const createdAt = new Date(new Date(inc.startedAt).getTime() + k * 10 * 60_000)
      await foc(eventRepo, { tenantId, incidentId: inc.incidentId, type, createdAt } as FindOptionsWhere<IncidentEvent>, {
        tenantId, incidentId: inc.incidentId, type, actorId: type === 'DECLARED' || k % 3 === 0 ? PEOPLE[(ii + k) % 4] : null,
        data: { ...SEED_META, ordinal: k }, createdAt,
      })
      bump('events')
    }
  }
  const participantRepo = ctx.repo<IncidentParticipant>(IncidentParticipant)
  const roles = ['COMMANDER', 'COMMS', 'RESPONDER', 'OBSERVER']
  for (const inc of incidents) {
    for (const [k, role] of roles.entries()) {
      await foc(participantRepo, { tenantId, incidentId: inc.incidentId, userId: PEOPLE[k] } as FindOptionsWhere<IncidentParticipant>, {
        tenantId, incidentId: inc.incidentId, userId: PEOPLE[k], role, assignedBy: PEOPLE[0], assignedAt: new Date(inc.startedAt),
      })
      bump('participants')
    }
  }
  const pmRepo = ctx.repo<IncidentPostmortem>(IncidentPostmortem)
  const pmStatuses = ['IN_REVIEW', 'PUBLISHED', 'DRAFT']
  for (const [k, inc] of incidents.entries()) {
    await foc(pmRepo, { tenantId, incidentId: inc.incidentId } as FindOptionsWhere<IncidentPostmortem>, {
      tenantId, incidentId: inc.incidentId, status: pmStatuses[k], summary: `What happened: ${inc.title}.`,
      impact: faker.sentence(14), rootCause: faker.sentence(12), contributingFactors: faker.sentence(10),
      wentWell: 'Alerting fired within two minutes.', wentPoorly: 'The runbook was out of date.', timelineText: faker.paragraph(3),
      authorUserId: PEOPLE[1], reviewerUserId: k === 0 ? PEOPLE[0] : null, publishedAt: pmStatuses[k] === 'PUBLISHED' ? at(-7) : null,
    })
  }
  const aiRepo = ctx.repo<IncidentAiNote>(IncidentAiNote)
  const aiDefs = [
    { kind: 'INVESTIGATION', status: 'OK', trigger: 'AUTO', inc: 0, feedback: 1 },
    { kind: 'STATUS_DRAFT', status: 'OK', trigger: 'MANUAL', inc: 0, feedback: null },
    { kind: 'POSTMORTEM_DRAFT', status: 'OK', trigger: 'RESOLVE', inc: 1, feedback: -1 },
    { kind: 'INVESTIGATION', status: 'EMPTY', trigger: 'AUTO', inc: 2, feedback: null },
    { kind: 'NL_QUERY', status: 'FAILED', trigger: 'MANUAL', inc: null, feedback: null },
  ]
  for (const [k, a] of aiDefs.entries()) {
    const createdAt = at(-1, k * 7)
    await foc(aiRepo, { tenantId, kind: a.kind, createdAt } as FindOptionsWhere<IncidentAiNote>, {
      tenantId, incidentId: a.inc === null ? null : incidents[a.inc].incidentId, kind: a.kind, status: a.status, trigger: a.trigger,
      requestedBy: a.trigger === 'MANUAL' ? PEOPLE[0] : null, provider: a.status === 'EMPTY' ? null : 'seed-provider', model: a.status === 'EMPTY' ? null : 'seed-model',
      promptVersion: 'v3', inputTokens: a.status === 'OK' ? 1800 + k * 100 : 0, outputTokens: a.status === 'OK' ? 400 : 0,
      result: a.status === 'OK' ? { summary: 'Connection pool saturation is the most likely cause.', hypotheses: ['pool saturation', 'slow query'], dropped: 0, ...SEED_META } : null,
      evidence: a.status === 'OK' ? [{ kind: 'alert', ref: 'seed-alert-1' }] : null,
      failure: a.status === 'FAILED' ? 'The provider did not answer in time.' : null,
      feedback: a.feedback, feedbackBy: a.feedback === null ? null : PEOPLE[2], feedbackAt: a.feedback === null ? null : at(-1, 60), createdAt,
    })
  }
  const embRepo = ctx.repo<IncidentEmbedding>(IncidentEmbedding)
  for (const [k, inc] of incidents.entries()) {
    const vector = Array.from({ length: 8 }, (_, j) => Math.round(Math.sin(k * 8 + j) * 1000) / 1000)
    await foc(embRepo, { tenantId, incidentId: inc.incidentId, model: 'seed-embed-8' } as FindOptionsWhere<IncidentEmbedding>, {
      tenantId, incidentId: inc.incidentId, provider: 'seed-provider', model: 'seed-embed-8', dims: 8, vector, textHash: sha256(inc.title),
    })
  }
  const tplRepo = ctx.repo<IncidentUpdateTemplate>(IncidentUpdateTemplate)
  for (const status of steps) {
    for (const locale of ['en', 'tr']) {
      await foc(tplRepo, { tenantId, status, locale } as FindOptionsWhere<IncidentUpdateTemplate>, {
        tenantId, status, locale, body: locale === 'en' ? `We are ${status.toLowerCase()} the issue with {component}.` : `{component} sorunu: ${status.toLowerCase()}.`,
        managedBy: status === 'RESOLVED' && locale === 'en' ? 'code' : null,
      })
      bump('templates')
    }
  }

  // ── Translations of the public words ────────────────────────────────────
  const trRepo = ctx.repo<StatusTranslation>(StatusTranslation)
  const translatable: Array<{ entityType: string; entityId: string; name: string }> = [
    ...pages.map((p) => ({ entityType: 'page', entityId: p.pageId, name: p.name })),
    ...groups.map((g) => ({ entityType: 'group', entityId: g.groupId, name: g.name })),
    ...components.map((c) => ({ entityType: 'component', entityId: c.componentId, name: c.name })),
    ...incidents.filter((i) => i.isPublic).map((i) => ({ entityType: 'incident', entityId: i.incidentId, name: i.title })),
    ...updates.slice(0, 4).map((u) => ({ entityType: 'update', entityId: u.updateId, name: u.status })),
  ]
  for (const t of translatable) {
    for (const locale of ['tr', 'de']) {
      await foc(trRepo, { tenantId, entityType: t.entityType, entityId: t.entityId, locale } as FindOptionsWhere<StatusTranslation>, {
        tenantId, entityType: t.entityType, entityId: t.entityId, locale, name: `${t.name} (${locale})`, body: t.entityType === 'update' ? `${t.name} [${locale}]` : null,
      })
      bump('translations')
    }
  }

  // ── Alerting ─────────────────────────────────────────────────────────────
  const integrationRepo = ctx.repo<AlertIntegration>(AlertIntegration)
  const integrations: AlertIntegration[] = []
  for (const [k, kind] of ['GENERIC', 'ALERTMANAGER', 'GRAFANA'].entries()) {
    const name = `${kind.charAt(0)}${kind.slice(1).toLowerCase()} (seed)`
    // keyHash is a hash of random bytes nobody holds: no request can ever authenticate as this integration.
    integrations.push(await foc(integrationRepo, { tenantId, name } as FindOptionsWhere<AlertIntegration>, {
      tenantId, name, kind, keyHash: sha256(randomBytes(32).toString('hex')), keyPrefix: `seed${k}`, severityCeiling: ['MAJOR', 'CRITICAL', 'MINOR'][k],
      defaultLabels: { env: 'seed', team: ['sre', 'payments', 'web'][k] }, enabled: k !== 2, managedBy: k === 1 ? 'code' : null,
      sourceKey: k === 1 ? 'code:seed-alertmanager' : null, lastUsedAt: k === 2 ? null : at(-1),
    }))
  }
  const routeRepo = ctx.repo<AlertRoute>(AlertRoute)
  const routeDefs = [
    { name: 'Critical to on-call', matchers: [{ label: 'severity', op: '=', value: 'CRITICAL' }], targets: [{ type: 'on_call', policyId: ON_CALL_POLICY_ID }], incident: 'auto', continueMatching: true },
    { name: 'Payments team', matchers: [{ label: 'team', op: '=', value: 'payments' }], targets: [{ type: 'notify', userIds: [PEOPLE[1]], emails: ['payments-oncall@example.test'], channels: ['mail'], urgency: 'NORMAL' }], incident: null, continueMatching: false },
    { name: 'Staging noise', matchers: [{ label: 'env', op: '=~', value: 'stag.*' }], targets: [{ type: 'drop' }], incident: 'never', continueMatching: false },
    { name: 'Everything else to webhook', matchers: [{ label: 'severity', op: '!=', value: 'INFO' }], targets: [{ type: 'webhook' }], incident: null, continueMatching: false },
  ]
  const routes: AlertRoute[] = []
  for (const [k, r] of routeDefs.entries()) {
    routes.push(await foc(routeRepo, { tenantId, name: r.name } as FindOptionsWhere<AlertRoute>, {
      tenantId, name: r.name, position: k, matchers: r.matchers, groupBy: k === 0 ? ['service'] : [], groupWaitSeconds: 30, groupIntervalSeconds: 300,
      targets: r.targets, incident: r.incident, continueMatching: r.continueMatching, enabled: k !== 3, managedBy: null, sourceKey: null,
    }))
  }
  const silenceRepo = ctx.repo<AlertSilence>(AlertSilence)
  const silenceDefs = [
    { reason: 'Database migration window (seed)', start: -20, hours: 4 },
    { reason: 'Known flaky staging probe (seed)', start: -2, hours: 24 * 7 },
    { reason: 'Planned network work (seed)', start: 30, hours: 6 },
  ]
  const silences: AlertSilence[] = []
  for (const s of silenceDefs) {
    const startsAt = at(s.start)
    silences.push(await foc(silenceRepo, { tenantId, reason: s.reason } as FindOptionsWhere<AlertSilence>, {
      tenantId, matchers: [{ label: 'service', op: '=', value: 'database' }], startsAt, endsAt: new Date(startsAt.getTime() + s.hours * 3600_000), createdBy: PEOPLE[0], reason: s.reason,
    }))
  }
  const silenceTplRepo = ctx.repo<AlertSilenceTemplate>(AlertSilenceTemplate)
  for (const [k, t] of [{ name: 'Deploy window', minutes: 30 }, { name: 'Weekend maintenance', minutes: 240 }].entries()) {
    await foc(silenceTplRepo, { tenantId, name: t.name } as FindOptionsWhere<AlertSilenceTemplate>, {
      tenantId, name: t.name, matchers: [{ label: 'env', op: '=', value: 'production' }], durationMinutes: t.minutes, reason: `${t.name} (seed)`,
      managedBy: k === 1 ? 'code' : null, sourceKey: k === 1 ? 'code:seed-weekend' : null,
    })
  }
  const depRepo = ctx.repo<AlertDependency>(AlertDependency)
  for (const [child, parent] of [['service:checkout', 'service:database'], ['service:api', 'service:database'], ['service:website', 'service:cdn']]) {
    await foc(depRepo, { tenantId, child, parent } as FindOptionsWhere<AlertDependency>, { tenantId, child, parent, managedBy: null })
  }
  const alertRepo = ctx.repo<Alert>(Alert)
  const alertCount = Math.min(ctx.count(4), 60)
  const sources = ['monitor', 'process', 'slo', 'integration', 'manual', 'extension']
  const severities = ['INFO', 'WARNING', 'MINOR', 'MAJOR', 'CRITICAL']
  const statuses = ['FIRING', 'RESOLVED', 'SUPPRESSED', 'RESOLVED']
  const services = ['database', 'checkout', 'api', 'website', 'jobs']
  for (let k = 0; k < alertCount; k++) {
    const fingerprint = sha256(`seed-alert-${k}`).slice(0, 32)
    const status = statuses[k % statuses.length]
    const startsAt = at(-(k + 1), k * 3)
    const service = services[k % services.length]
    await foc(alertRepo, { tenantId, fingerprint } as FindOptionsWhere<Alert>, {
      tenantId, fingerprint, source: sources[k % sources.length], sourceRef: k % 6 === 3 ? integrations[0].integrationId : `seed-ref-${k}`,
      title: `${service} ${['latency high', 'error rate high', 'unreachable', 'budget burning'][k % 4]}`,
      severity: severities[k % severities.length], status,
      suppressedBy: status === 'SUPPRESSED' ? (k % 2 ? `silence:${silences[0].silenceId}` : 'maintenance') : null,
      labels: { service, env: 'production', team: ['sre', 'payments', 'web'][k % 3], seed: 'true', synthetic: 'true' }, annotations: { summary: faker.sentence(8) },
      groupKey: `seed-group-${service}`, routeId: routes[k % routes.length].routeId, startsAt, endsAt: status === 'RESOLVED' ? new Date(startsAt.getTime() + 2 * 3600_000) : null,
      lastFiredAt: startsAt, count: 1 + (k % 5), dispatchAfter: null, notifiedAt: status === 'SUPPRESSED' ? null : new Date(startsAt.getTime() + 30_000),
      acknowledgedAt: k % 3 === 0 ? new Date(startsAt.getTime() + 300_000) : null, acknowledgedBy: k % 3 === 0 ? PEOPLE[k % 4] : null,
      incidentId: k < 3 ? incidents[k].incidentId : null,
    })
  }
  n.alerts = alertCount

  // ── Chat destinations (disabled or non-decryptable) ─────────────────────
  const chatRepo = ctx.repo<ChatDestination>(ChatDestination)
  const chatDefs = [
    { kind: 'SLACK', label: '#incidents (seed)', audience: 'INTERNAL', enabled: false, lastStatus: 'sent', failures: 0 },
    { kind: 'TEAMS', label: 'Customer success (seed)', audience: 'PUBLIC', enabled: false, lastStatus: 'http_404', failures: 10 },
  ]
  for (const [k, c] of chatDefs.entries()) {
    const urlFingerprint = sha256(`seed-chat-destination-${k}`)
    await foc(chatRepo, { tenantId, urlFingerprint } as FindOptionsWhere<ChatDestination>, {
      tenantId, kind: c.kind, label: c.label, urlCipher: 'seed-placeholder-not-a-ciphertext', urlHost: 'hooks.seed.example.invalid', urlFingerprint,
      audience: c.audience, events: k ? ['incident.created', 'incident.resolved'] : null, severities: k ? ['MAJOR', 'CRITICAL'] : null,
      enabled: c.enabled, consecutiveFailures: c.failures, lastStatus: c.lastStatus, lastSentAt: at(-3), disabledAt: c.failures >= 10 ? at(-2) : null, createdBy: PEOPLE[0],
    })
  }

  // ── SLOs (no burn alerts) ────────────────────────────────────────────────
  const sloRepo = ctx.repo<Slo>(Slo)
  const sloDefs = [
    { name: 'Website availability', kind: 'MONITOR_AVAILABILITY', objectivePercent: '99.9', windowDays: 30, monitors: [0], componentId: null, lastState: 'OK' },
    { name: 'API latency under 500 ms', kind: 'MONITOR_LATENCY', objectivePercent: '99.0', windowDays: 7, monitors: [1], componentId: null, latencyThresholdMs: 500, lastState: 'LOW' },
    { name: 'Database availability', kind: 'MONITOR_AVAILABILITY', objectivePercent: '99.95', windowDays: 28, monitors: [], componentId: 3, lastState: 'EXHAUSTED' },
    { name: 'Checkout flow availability', kind: 'MONITOR_AVAILABILITY', objectivePercent: '99.5', windowDays: 90, monitors: [3], componentId: null, lastState: 'NO_DATA' },
  ]
  for (const [k, s] of sloDefs.entries()) {
    await foc(sloRepo, { tenantId, name: s.name } as FindOptionsWhere<Slo>, {
      tenantId, name: s.name, description: `${s.name} (seed).`, kind: s.kind, objectivePercent: Number(s.objectivePercent), windowDays: s.windowDays,
      monitorIds: s.monitors.map((i) => monitors[i].monitorId), componentId: s.componentId === null ? null : components[s.componentId].componentId,
      latencyThresholdMs: s.latencyThresholdMs ?? null, metricSpec: null, lowBudgetPercent: 25, burnAlerts: false, isActive: k !== 3,
      managedBy: null, sourceKey: null, ownerUserId: PEOPLE[k % 4], lastState: s.lastState, lastEvaluatedAt: at(-1),
    })
  }

  // ── Daily metering reconciliation ───────────────────────────────────────
  const recRepo = ctx.repo<ObservabilityReconciliation>(ObservabilityReconciliation)
  const kinds = ['probe_runs', 'alerts', 'sms_pages', 'voice_pages']
  const recStatuses = ['OK', 'OK', 'DIVERGED', 'SKIPPED']
  for (let d = 1; d <= 5; d++) {
    for (const [k, kind] of kinds.entries()) {
      const day = utcDay(at(-d))
      const status = recStatuses[(d + k) % recStatuses.length]
      const actual = 100 * (k + 1) + d
      const metered = status === 'SKIPPED' ? null : status === 'DIVERGED' ? actual + 7 : actual
      await foc(recRepo, { tenantId, day, kind } as FindOptionsWhere<ObservabilityReconciliation>, {
        tenantId, day, kind, metered, actual, status, difference: metered === null ? 0 : metered - actual, detail: { ...SEED_META },
      })
      bump('reconciliations')
    }
  }

  ctx.refs.syntheticObservabilityTenantId = tenantId
  ctx.log(`observability(full): ${monitors.length} monitors, ${n.checks} checks, ${locations.length} locations, ${n.runners} runners, ${components.length} components, ${pages.length} status pages, ${incidents.length} incidents, ${n.events} incident events, ${n.alerts} alerts, ${routes.length} routes, ${n.translations} translations for synthetic tenant ${tenantId}`)
}
