import { PrismaClient as Orginal, User, TenantSetting, SystemSetting, Tenant, TenantMember, TenantMemberInvitation , Notification} from "@prisma/client";


const prisma = new Orginal();


export type { User, TenantSetting, SystemSetting , Tenant, TenantMember, TenantMemberInvitation, Notification}

export default prisma ;