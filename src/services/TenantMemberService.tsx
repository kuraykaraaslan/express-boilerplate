import prisma, { Tenant, TenantMember, User } from "../libs/prisma";

export default class TenantMemberService {

    static async getMembership(tenant: Tenant, user: User): Promise<TenantMember> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        if (!user) {
            throw new Error("INVALID_USER");
        }

        const membership = await prisma.tenantMember.findFirst({
            where: {
                tenantId: tenant.tenantId,
                userId: user.userId
            }
        });

        if (!membership) {
            // User is not a member of the tenant then check if the user is a admin
            if (user.roles.includes("ADMIN")) {
                // Create a temporary membership object
                return {
                    tenantMemberId: "TEMP",
                    tenantId: tenant.tenantId,
                    userId: user.userId,
                    roles: ["USER", "ADMIN"],
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
            }

            throw new Error("MEMBERSHIP_NOT_FOUND");
        }

        return membership;

    }

    static async createMembership(tenant: Tenant, user: User, roles: string[]): Promise<TenantMember> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        if (!user) {
            throw new Error("INVALID_USER");
        }

        if (!roles) {
            throw new Error("INVALID_ROLES");
        }

        const membership = await prisma.tenantMember.create({
            data: {
                tenantId: tenant.tenantId,
                userId: user.userId,
                roles
            }
        });

        return membership;

    }

    static checkIfMemberHasRole(tenant: Tenant, member: TenantMember, roles: string[] | string): boolean {
        // Check if the user has the required roles
        if (!tenant || !member) {
            return false;
        }

        // Check if the tenantId of the tenant and member are same
        if (tenant.tenantId !== member.tenantId) {
            return false;
        }

        // Convert the roles to array if it is not
        if (typeof roles === 'string') {
            roles = [roles];
        }

        // Check if the user has the required roles
        if (member.roles.includes('ADMIN')) {
            return true
        }

        const result = roles.every(role => member.roles.includes(role));

        return result;
    }

    static async removeMembership(tenant: Tenant, user: User): Promise<void> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        if (!user) {
            throw new Error("INVALID_USER");
        }

        await prisma.tenantMember.deleteMany({
            where: {
                tenantId: tenant.tenantId,
                userId: user.userId
            }
        });
    }

    static async getTenantMembershipsByUser(user: User, page: number, pageSize: number): Promise<TenantMember[]> {

        if (!user) {
            throw new Error("INVALID_USER");
        }

        if (!page) {
            page = 0;
        }

        if (!pageSize) {
            pageSize = 10;
        }

        if (page < 0 || pageSize < 0) {
            throw new Error("INVALID_PAGE_OR_PAGE_SIZE");
        }

        const memberships = await prisma.tenantMember.findMany({
            where: {
                userId: user.userId
            },
            skip: page * pageSize,
            take: pageSize,
            include: {
                tenant: {
                    select: {
                        tenantId: true,
                        domain: true,
                        name: true
                    }
                }
            }
        });

        return memberships;

    }

}

