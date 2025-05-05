import { Tenant } from "@prisma/client";

export default interface SafeTenant extends Omit<Tenant, 'createdAt' | 'updatedAt' | 'deletedAt'> {}

export type { SafeTenant };