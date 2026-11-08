import { NextResponse } from 'next/server';
import { requireActionStepUp, type ActionStepUpSubject } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.step-up.next';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AdminActionNoteSchema } from './user.dto';
import { validationRefusal } from './user.admin-guard';

/**
 * Phase 55 00.6: the request half shared by the admin actuator routes (users-user-id-sessions*, -trusted-devices*,
 * -must-change-password). The body is optional: none (or an empty one) is "no note"; anything but `{ reason? }` is a 400.
 */
export async function readActionNote(request: Request): Promise<{ ok: true; reason: string | null } | { ok: false; response: NextResponse }> {
  const raw = await request.text().catch(() => '');
  let body: unknown = {};
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { body = null; }
  }
  const parsed = AdminActionNoteSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: NextResponse.json(validationRefusal(parsed.error.issues), { status: 400 }) };
  return { ok: true, reason: parsed.data.reason ?? null };
}

/**
 * The acting administrator's strict step-up for one action on one person (purpose = the route's permission, target = the
 * person), handed to the service as its `confirm` so it runs after the ranks and before the effect. These routes are platform
 * routes (placement root, GLOBAL scope): the grant is the root tenant's, where the platform pages ask for it.
 */
export function platformStepUp(request: Request, subject: ActionStepUpSubject, purpose: string, userId?: string) {
  return () => requireActionStepUp(request, subject, { tenantId: ROOT_TENANT_ID, purpose, ...(userId ? { target: userId } : {}) });
}
