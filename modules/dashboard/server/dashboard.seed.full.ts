import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { DashboardBoard } from './entities/dashboard_board.entity';
import { DashboardDisplayLink } from './entities/dashboard_display_link.entity';

const DAY = 24 * 60 * 60 * 1000;
const ANCHOR = Date.UTC(2026, 6, 1, 8, 0, 0);
const at = (days: number) => new Date(ANCHOR + days * DAY);

/**
 * Full-load seed for `dashboard`: wall-display links (`dashboard_display_links`) on the tenant's boards.
 *
 * Why not in the default seed: a display link is a bearer credential to a board.
 *
 * How this stays harmless: the token hash is the hash of random bytes that are thrown away, so no
 * request can ever present the token; the links cover active, revoked and expired states.
 * Idempotent: keyed on (tenant, board, label); dates are fixed.
 */
export async function seedDashboardFull(ctx: SeedContext): Promise<void> {
  const { tenantId } = ctx;
  const boards = await ctx.repo<DashboardBoard>(DashboardBoard).find({ where: { tenantId } as FindOptionsWhere<DashboardBoard>, order: { boardId: 'ASC' } as never, take: 3 });
  if (boards.length === 0) {
    ctx.log('dashboard(full): no boards for this tenant, no display links');
    return;
  }
  const repo = ctx.repo<DashboardDisplayLink>(DashboardDisplayLink);
  const defs = [
    { label: 'Office lobby screen', createdAt: at(-30), expiresAt: new Date(Date.UTC(2027, 6, 1)), revoked: false, lastUsed: at(-1) },
    { label: 'Ops room TV', createdAt: at(-60), expiresAt: new Date(Date.UTC(2027, 0, 1)), revoked: true, lastUsed: at(-20) },
    { label: 'Trade fair kiosk', createdAt: at(-120), expiresAt: at(-90), revoked: false, lastUsed: null },
  ];
  let n = 0;
  for (const board of boards) {
    for (const d of defs) {
      const token = randomBytes(24).toString('base64url');
      await ctx.foc(repo, { tenantId, boardId: board.boardId, label: d.label } as FindOptionsWhere<DashboardDisplayLink>, {
        tenantId, boardId: board.boardId, tokenHash: createHash('sha256').update(token).digest('hex'), tokenHint: token.slice(-4),
        label: d.label, createdByUserId: SEED_ADMIN_USER_ID, createdAt: d.createdAt, expiresAt: d.expiresAt,
        revokedAt: d.revoked ? at(-10) : null, revokedByUserId: d.revoked ? SEED_ADMIN_USER_ID : null, lastUsedAt: d.lastUsed,
      });
      n++;
    }
  }
  ctx.log(`dashboard(full): ${n} display links on ${boards.length} boards`);
}
