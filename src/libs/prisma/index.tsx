import { PrismaClient as Orginal, User, Prisma, TenantSetting, SystemSetting, Tenant, TenantMember, TenantMemberInvitation , Category, Post} from "@prisma/client";


const prisma = new Orginal(
  

).$extends({
  model: {
    user: {
      async sayhello() {
        console.log("Hello from PrismaClient");
      }
    },
  },
})


export type { User, Prisma, TenantSetting, SystemSetting , Tenant, TenantMember, TenantMemberInvitation, Category, Post}

export default prisma ;