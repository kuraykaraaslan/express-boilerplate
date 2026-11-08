import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import { resetAndRedeploy, resolveDeployTarget } from '@kuraykaraaslan-labs/db/server/db.deploy';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';

// Schema sync + reseed needs the full Node runtime (pg, typeorm, bcrypt, fs)
// and runs longer than the default serverless budget.
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET|POST /tenant/[tenantId]/api/cron/demo-reset
 *
 * DESTRUCTIVE demo reset. Drops the database schema and re-runs the full deploy
 * pipeline (schema sync → SQL migrations → bootstrap seed) so the demo returns
 * to a clean seeded state. Wired to a Vercel cron (every 15 minutes) — Vercel
 * invokes it with `Authorization: Bearer $CRON_SECRET`.
 *
 * Guarded so it can never wipe a real database by accident:
 *   0. On a fleet role (FLEET_ROLE or the baked BUILD_ROLE is node or fleet) the
 *      route does not exist: 404 before anything else is read (P9-9; the env
 *      schema also refuses DEMO_MODE on those roles).
 *   1. DEMO_MODE must be true.
 *   2. CRON_SECRET must be configured.
 *   3. Bearer token must match CRON_SECRET.
 *
 * The `tenantId` in the path is ignored — the job is platform-wide; the path is
 * just where serverless crons can reach it. Call it on the root tenant.
 */
/** A fleet node or the fleet instance never serves the demo reset, whatever DEMO_MODE says. */
function isFleetManagedProcess(): boolean {
  return [env.FLEET_ROLE, env.BUILD_ROLE].some((role) => role === 'node' || role === 'fleet');
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (isFleetManagedProcess()) {
    return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  }

  if (!env.DEMO_MODE) {
    Logger.warn('[Cron:demo-reset] DEMO_MODE not enabled — destructive reset refused');
    return NextResponse.json(
      { success: false, message: 'Demo mode disabled' },
      { status: 403 },
    );
  }

  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    Logger.warn('[Cron:demo-reset] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:demo-reset] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const target = resolveDeployTarget();
  if (!target) {
    Logger.warn('[Cron:demo-reset] DATABASE_URL not set — nothing to reset');
    return NextResponse.json({ success: false, message: 'No database configured' }, { status: 503 });
  }

  // db.03: a database whose name says production is never dropped, whatever DEMO_MODE says (a demo flag copied into a
  // production environment must not be enough).
  if (looksLikeProduction(target.url)) {
    Logger.error('[Cron:demo-reset] target database name looks like production — destructive reset refused');
    return NextResponse.json({ success: false, message: 'Refused for this database' }, { status: 403 });
  }
  // db.03: one reset at a time in this process (an overlapping DROP SCHEMA / reseed corrupts the demo).
  if (resetRunning) {
    return NextResponse.json({ success: false, message: 'A reset is already running' }, { status: 409 });
  }

  resetRunning = true;
  try {
    Logger.warn('[Cron:demo-reset] destructive reset starting — wiping and reseeding database');
    await resetAndRedeploy(target);
    Logger.info('[Cron:demo-reset] database reset and reseeded');
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:demo-reset] Failed: ${message}`);
    // db.06: the raw message (hosts, roles, SQL) stays in the log.
    return NextResponse.json({ success: false, message: 'Reset failed' }, { status: 500 });
  } finally {
    resetRunning = false;
  }
}

let resetRunning = false;

/** The database name of a DSN reads as production (`app_production`, `prod`, `shop-live`, ...). An unparsable DSN counts as production. */
function looksLikeProduction(url: string): boolean {
  let name: string;
  try { name = decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch { return true; }
  return /(^|[^a-z])(prod|production|live)([^a-z]|$)/i.test(name);
}

export const GET = handle;
export const POST = handle;
