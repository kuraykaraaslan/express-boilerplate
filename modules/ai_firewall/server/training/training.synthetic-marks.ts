import { createHash } from 'node:crypto';
import { exportIdOf } from '../dataset/ai_firewall.dataset-export';

/**
 * The synthetic generator's marks (docs/phases/55-ai-firewall/04-tree-models.md 4.1, D55-104). Its rows are re-keyed under a PUBLIC
 * export key, so its tenant ids are known values: a real export re-keys under 32 random bytes nobody keeps, so none of its ids can be
 * one of these (2^-132). The trainer marks a dataset synthetic when its manifest says so OR any row carries one of these tenants, so
 * editing the manifest does not turn a synthetic dataset into a shippable one.
 */
export const SYNTHETIC_EXPORT_KEY: Buffer = createHash('sha256').update('nb.ai_firewall.synthetic-dataset/1').digest();
export const SYNTHETIC_TENANT_COUNT = 4;
export const syntheticTenantRawId = (i: number): string => `synthetic-tenant-${i}`;

const SYNTHETIC_TENANT_IDS: ReadonlySet<string> = new Set(
  Array.from({ length: SYNTHETIC_TENANT_COUNT }, (_, i) => exportIdOf(SYNTHETIC_EXPORT_KEY, 'tenant', syntheticTenantRawId(i))),
);

export const isSyntheticTenant = (exportedTenantId: string): boolean => SYNTHETIC_TENANT_IDS.has(exportedTenantId);
