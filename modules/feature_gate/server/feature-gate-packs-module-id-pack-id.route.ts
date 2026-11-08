import { NextRequest, NextResponse } from 'next/server';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { servePack } from './feature_gate.protected-packs';

type Ctx = { params: Promise<{ tenantId: string; moduleId: string; packId: string }> };

const ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** Every refusal looks the same: no body, nothing to tell a wrong ticket from a wrong pack. */
const refused = () => new NextResponse(null, { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/**
 * GET /tenant/[tenantId]/api/feature_gate/packs/[moduleId]/[packId]?t=<ticket>
 * The code of a protected pack (dashboard phase 33, ADR-0016, contract C3), for a page that holds a ticket the owning module issued
 * (`issuePackTicket`). Only the ticket is checked (its signature, expiry, tenant, module and packs), so no session is read and a
 * display link's screen loads packs the same way. The answer is the pack marked with the ticket's mark, as a module script:
 * `private` (one download's copy, never a shared cache), same-origin only, never sniffed. Anything else is a 403 with no body.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId, packId } = await params;
    const { default: Limiter } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service.next');
    await Limiter.checkRateLimit(request);
    if (!ID.test(moduleId) || !ID.test(packId)) return refused();
    const code = await servePack({ tenantId, moduleId, packId, ticket: request.nextUrl.searchParams.get('t') });
    if (code === null) return refused();
    return new NextResponse(code, {
      status: 200,
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'private, max-age=600',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return normalizeError(error);
  }
}
