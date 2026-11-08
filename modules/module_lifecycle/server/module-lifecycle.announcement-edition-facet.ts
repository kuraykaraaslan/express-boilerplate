import { In, IsNull } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import type { AudienceFacetProvider } from '@kuraykaraaslan-labs/announcement/server/announcement.types';
import { Install } from './entities/install.entity';

/** The editions a customer can be told apart by (core is every tenant; custom is the operator's own modules). */
const EDITIONS: Array<{ value: string; label: string }> = [
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'iot', label: 'IoT' },
];

/**
 * The `edition` audience of a platform announcement (point `announcement:audience_facet`, docs/phases/47-announcements
 * D18): the tenants using at least one active module of a chosen edition ("every IoT customer"), read from the install
 * ledger and the manifests' `edition`. A cross-tenant read.
 */
const provider: AudienceFacetProvider = {
  async options() {
    return EDITIONS;
  },
  async tenantsMatching(values) {
    const wanted = new Set(values);
    const moduleIds = moduleRegistry.getModules().filter((m) => m.edition && wanted.has(m.edition)).map((m) => m.id);
    if (moduleIds.length === 0) return [];
    const rows = await withSystemRLS((qr) => qr.manager.getRepository(Install).find({
      select: { tenantId: true },
      where: { artifactType: 'module', artifactId: In(moduleIds), active: true, uninstalledAt: IsNull() },
    }));
    return [...new Set(rows.map((r) => r.tenantId))];
  },
};

export default provider;
