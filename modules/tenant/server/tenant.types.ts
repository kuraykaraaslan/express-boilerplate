import { z } from 'zod';
import { TenantStatusEnum } from './tenant.enums';

export const TenantSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  region: z.string().nullable().optional(),
  // phase 49.1: the ISO alpha-2 country the price list is looked up by, and where it came from (operator | geoip | locale | default)
  countryCode: z.string().nullable().optional(),
  countrySource: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  tenantStatus: TenantStatusEnum.default('ACTIVE'),

  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
  // A tenant's custom domains are tenant_domain's, not part of this read model: the operator's tenant page shows them
  // in the panel tenant_domain contributes (`common:entity_panel`), and tenant does not import tenant_domain, which
  // requires it (docs/phases/37-extensions/10, 2026-10-17 second pass).
});

export const SafeTenantSchema = TenantSchema.omit({
  deletedAt: true
});

export type Tenant = z.infer<typeof TenantSchema>;
export type SafeTenant = z.infer<typeof SafeTenantSchema>;
