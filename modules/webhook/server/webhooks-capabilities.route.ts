import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';

/** Each answered capability and the permission its route requires (the routes' own `requiredPermission`). */
export const WEBHOOK_CAPABILITY_PERMISSIONS = {
  /** POST /webhooks */
  createEndpoints: 'webhook.endpoints.create',
  /** PATCH /webhooks/[id] (the edit form and the active toggle). */
  updateEndpoints: 'webhook.endpoints.update',
  /** DELETE /webhooks/[id] */
  deleteEndpoints: 'webhook.endpoints.delete',
  /** POST /webhooks/[id]/rotate-secret (OWNER by default). */
  rotateSecret: 'webhook.endpoints.rotate_secret',
  /** POST /webhooks/[id]/test */
  sendTest: 'webhook.endpoints.test',
  /** POST /webhooks/[id]/trigger */
  trigger: 'webhook.endpoints.trigger',
  /** GET /webhooks/[id]/deliveries */
  readDeliveries: 'webhook.deliveries.read',
  /** POST /webhooks/[id]/deliveries/[did]/redeliver */
  redeliver: 'webhook.deliveries.redeliver',
  /** POST /webhooks/[id]/deliveries/replay-dead-letter (its own permission, not redeliver's). */
  replayDeadLetters: 'webhook.deliveries.replay',
  /** GET /webhooks/metrics (stat cards, the dashboard widget). */
  readMetrics: 'webhook.metrics.read',
  /** GET /webhooks/report (overview chart, reliability, the dead-letter count). */
  readReports: 'webhook.reports.read',
  /** GET /webhooks/events (the event picker of the form and the trigger modal). */
  readEvents: 'webhook.events.read',
  /** GET /admin-settings (the settings page behind the gear). */
  readSettings: 'tenant_setting.config.read',
  /** PUT /admin-settings */
  updateSettings: 'tenant_setting.config.update',
} as const;

export type WebhookCapabilityKey = keyof typeof WEBHOOK_CAPABILITY_PERMISSIONS;

/**
 * GET /api/webhooks/capabilities
 *
 * Which webhook actions the caller holds (41-ui-fixes/12 3.1, decision e). The console opens with
 * `webhook.endpoints.read`, and the admin shell's granted set carries only menu permissions, so every action was offered
 * to every caller (Rotate, which needs OWNER, to every ADMIN) and failed with a 403. The PDP and the role floor answer
 * here (`grantedPermissions`, the decision the routes make). A display, not a decision: every route judges again.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, scope: 'TENANT', requiredPermission: 'webhook.endpoints.read' });
    const granted = await grantedPermissions({
      request, tenantId, session: { user: auth.user, tenantMember: auth.tenantMember },
      permissionIds: Object.values(WEBHOOK_CAPABILITY_PERMISSIONS),
    });
    const capabilities = Object.fromEntries(
      Object.entries(WEBHOOK_CAPABILITY_PERMISSIONS).map(([key, permission]) => [key, granted.has(permission)]),
    ) as Record<WebhookCapabilityKey, boolean>;
    return NextResponse.json({ capabilities }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
