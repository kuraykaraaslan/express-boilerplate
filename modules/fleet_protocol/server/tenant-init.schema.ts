import { z } from 'zod';

/**
 * The shape of what `tenant.provision` carries about a new tenant (docs/phases/02-fleet/03 section 8.10), without the sealing: browser-safe, so the
 * operator's console validates the init before it seals it (`seal.web.ts`), and the node validates what it opens (`tenant-init.ts`) against the same rule.
 */
/** The tenant module's slug rule (2 to 63 characters, lower-case letters, digits and inner hyphens), so a sealed slug is always one the node can use. */
export const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

export const TenantInitSchema = z.object({
  slug: z.string().regex(TENANT_SLUG_RE),
  ownerEmail: z.string().max(254).email(),
  displayName: z.string().trim().min(1).max(100),
}).strict();
export type TenantInit = z.infer<typeof TenantInitSchema>;
