import type { SeederContribution } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { seedTelemetryFull } from './telemetry.seed.full';

/**
 * The `db:seeder` contribution: full-load lane only, the default seed leaves readings to their producers (exempt as
 * `runtime-state`). Tier 1: it reads no other module's rows.
 */
const seeder: SeederContribution = { name: 'telemetry', tier: 1, run: seedTelemetryFull };

export default seeder;
