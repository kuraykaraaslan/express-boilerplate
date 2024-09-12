import prisma, { Tenant, TenantMember, User, TenantMemberInvitation } from "../libs/prisma";
import AuthService from "./AuthService";
import TenantService from "./TenantService";
import Validater from "../helpers/Validater";

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

    static async createMembership(tenant: Tenant, user: User, roles: string[] = ["USER"]): Promise<TenantMember> {

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

    static async getTenantMembershipsByUser(user: User, page: number, pageSize: number): Promise<any> {

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

        return await prisma.$transaction([
            prisma.tenantMember.findMany({
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
            }),
            prisma.tenantMember.count({
                where: {
                    userId: user.userId
                }
            }),
        ])
            .then((query) => {
                return {
                    memberships: query[0],
                    total: query[1],
                    page,
                    pageSize,
                };
            });


    }

    static async listAllTenantMemberships(page: number, pageSize: number): Promise<any> {

        if (!page) {
            page = 0;
        }

        if (!pageSize) {
            pageSize = 10;
        }

        if (page < 0 || pageSize < 0) {
            throw new Error("INVALID_PAGE_OR_PAGE_SIZE");
        }

        return await prisma.$transaction([
            prisma.tenantMember.findMany({
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
            }),
            prisma.tenantMember.count(),
        ])
            .then((query) => {
                return {
                    memberships: query[0],
                    total: query[1],
                    page,
                    pageSize,
                };
            });
    }


    static async listAllInvitationsByTenant(tenant: Tenant, page?: number, pageSize?: number): Promise<any> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
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

        return await prisma.$transaction([
            prisma.tenantMemberInvitation.findMany({
                where: {
                    tenantId: tenant.tenantId
                },
                skip: page * pageSize,
                take: pageSize
            }),
            prisma.tenantMemberInvitation.count({
                where: {
                    tenantId: tenant.tenantId
                }
            }),

        ])
            .then((query) => {
                return {
                    invitations: query[0],
                    total: query[1],
                    page,
                    pageSize,
                };
            });

    }

    static async inviteUser(tenant: Tenant, email: string): Promise<TenantMemberInvitation> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        if (!email) {
            throw new Error("INVALID_EMAIL");
        }

        Validater.validateEmail(email);

        const invitation = await prisma.tenantMemberInvitation.create({
            data: {
                tenantId: tenant.tenantId,
                email
            }
        });

        return invitation;

    }

    static async acceptInvitation(tenant: Tenant, user: User, invitationId: string): Promise<TenantMember> {

        if (!user) {
            throw new Error("INVALID_USER");
        }

        if (!invitationId) {
            throw new Error("INVALID_INVITATION_ID");
        }

        Validater.validateID(invitationId);

        const invitation = await prisma.tenantMemberInvitation.findUnique({
            where: {
                tenantMemberInvitationId: invitationId
            }
        });

        if (!invitation) {
            throw new Error("INVITATION_NOT_FOUND");
        }

        if (invitation.tenantId !== tenant.tenantId) {
            throw new Error("INVALID_INVITATION");
        }

        const membership = await TenantMemberService.createMembership(tenant, user);

        await prisma.tenantMemberInvitation.delete({
            where: {
                tenantMemberInvitationId: invitationId
            }
        });

        return membership;
    }
}

