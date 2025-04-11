import { Tenant } from "@prisma/client";

export default interface TenantOmit extends Omit<Tenant, 'createdAt' | 'updatedAt'> {}

export type { TenantOmit };