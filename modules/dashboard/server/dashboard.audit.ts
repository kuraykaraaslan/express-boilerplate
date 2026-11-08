import Logger from '@kuraykaraaslan-labs/logger'
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/** The board-write actions that leave an audit row (15.4e). Commands have their own (`auditCommand`). */
export type BoardAuditAction =
  | 'dashboard.board.create'
  | 'dashboard.board.update'
  // A personal board shared with the workspace (phase 39, UX-1).
  | 'dashboard.board.share'
  | 'dashboard.board.delete'
  | 'dashboard.board.duplicate'
  | 'dashboard.board.export'
  | 'dashboard.board.import'
  | 'dashboard.board.layout'
  // Discard in Customise (owner 2026-10-27): the board put back as it was when customising started.
  | 'dashboard.board.restore'
  | 'dashboard.board.template_apply'
  | 'dashboard.placement.create'
  | 'dashboard.placement.update'
  | 'dashboard.placement.delete'
  // Widget library writes (dashboard.06): a widget is what every board that places it renders.
  | 'dashboard.widget.create'
  | 'dashboard.widget.update'
  | 'dashboard.widget.delete'
  | 'dashboard.widget.publish'
  | 'dashboard.widget.transition'
  | 'dashboard.widget.import'
  // Display links (owner decision 2026-10-17 #10): minting and revoking a screen's credential.
  | 'dashboard.display_link.create'
  | 'dashboard.display_link.revoke'
  // Card overlays (phase 38, E38-11): a card's settings for one subject entity, set and reset.
  | 'dashboard.card_overlay.set'
  | 'dashboard.card_overlay.reset'
  // Scene bindings (phase 42, D42-9): which document a subject shows and which device is which, set and reset.
  | 'dashboard.scene_binding.set'
  | 'dashboard.scene_binding.reset'
  // The bulk action of D42-7: every unbound device of a profile bound to one document; one row for the whole call, with the count.
  | 'dashboard.scene_binding.bulk'

/** Keys of a patch body, never the values: a settings blob or a binding can be large and is not an audit fact. */
export function changedKeys(body: unknown): string[] {
  return body && typeof body === 'object' ? Object.keys(body as Record<string, unknown>).sort() : []
}

/**
 * One audit row per successful board or placement write. Best effort: a failing
 * audit sink is logged and never fails the write. `audit_log` stays off the hard
 * `requires` graph (dynamic import), as `auditCommand` already does.
 */
export async function auditBoardWrite(entry: {
  tenantId: string
  userId: string
  action: BoardAuditAction
  resourceType: 'dashboard_board' | 'dashboard_placement' | 'dashboard_widget' | 'dashboard_display_link' | 'dashboard_card_overlay' | 'dashboard_scene_binding'
  resourceId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    await AuditLogService.log({
      tenantId: entry.tenantId,
      actorId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata ?? {},
    })
  } catch (err) {
    Logger.warn(`[dashboard] board audit failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** What a screen did through a display link: opened the board, read its cards, or was refused. */
export type DisplayAuditAction = 'dashboard.display.open' | 'dashboard.display.read' | 'dashboard.display.denied'

/** One `denied` row per link per this many seconds: a forgotten screen polling a revoked link must not flood the chain. */
export const DISPLAY_DENIED_THROTTLE_SECONDS = 60

/**
 * One audit row per display request (decision #10: every use is audited). There is no actor: a screen is not a
 * person, so the row is a SYSTEM one naming the link and, in its metadata, the issuer whose authority the screen
 * borrowed. The kiosk's IP and user agent are kept like any request's. Never the token.
 *
 * Best effort, like `auditBoardWrite`. `denied` is throttled per link (Redis SET NX EX); when Redis is down the row is
 * written, since losing a refusal is worse than a duplicate one.
 */
export async function auditDisplay(entry: {
  tenantId: string
  action: DisplayAuditAction
  linkId: string
  boardId: string
  issuerUserId: string
  request: { headers: { get(name: string): string | null } }
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    if (entry.action === 'dashboard.display.denied') {
      // Lazy, like the audit sink: the board-write callers of this file never need Redis.
      const { default: redis } = await import('@kuraykaraaslan-labs/redis')
      const first = await redis
        .set(`dash:display:denied:${entry.linkId}`, '1', 'EX', DISPLAY_DENIED_THROTTLE_SECONDS, 'NX')
        .catch(() => 'OK')
      if (first !== 'OK') return
    }
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    const h = entry.request.headers
    await AuditLogService.log({
      tenantId: entry.tenantId,
      actorId: null,
      actorType: 'SYSTEM',
      action: entry.action,
      resourceType: 'dashboard_display_link',
      resourceId: entry.linkId,
      ipAddress: clientIpOf(h) ?? null,
      userAgent: h.get('user-agent'),
      metadata: { boardId: entry.boardId, issuerUserId: entry.issuerUserId, ...(entry.metadata ?? {}) },
    })
  } catch (err) {
    Logger.warn(`[dashboard] display audit failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
