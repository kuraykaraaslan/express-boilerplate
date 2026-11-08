import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { Translation } from './entities/translation.entity';

/**
 * Full-load seed for `translation` (the guarded test database only). The module is exempt from the default seed as `own-script`:
 * a language's first load is `data/seed/<lang>.json`, applied with `npm run translation:import`. The full-load lane still fills
 * the table, with three Bulgarian texts taken from that same file (so a seeded row never differs from what the import writes):
 * two web texts of different modules and one mobile text. Idempotent: the table's unique (locale, module, platform, key).
 */
export async function seedTranslationFull(ctx: SeedContext): Promise<void> {
  if (!ctx.fullLoad) return;
  const file = join(__dirname, '..', 'data', 'seed', 'bg.json');
  let texts: Record<string, string>;
  try {
    texts = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    return; // a copy without the seed file has nothing to load from
  }
  const pick = (prefix: string) => Object.entries(texts).find(([k, v]) => k.startsWith(prefix) && typeof v === 'string' && v.length > 0);
  const rows: Array<Partial<Translation>> = [];
  for (const [prefix, platform] of [['auth.', null], ['dashboard.', null], ['auth.', 'mobile']] as const) {
    const hit = pick(prefix);
    if (hit) rows.push({ locale: 'bg', module: prefix.slice(0, -1), platform, key: hit[0], value: hit[1] });
  }
  if (rows.length) await ctx.systemRepo(Translation).createQueryBuilder().insert().values(rows as never).orIgnore().execute();
}
