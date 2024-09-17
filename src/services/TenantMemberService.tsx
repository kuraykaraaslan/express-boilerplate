import prisma, { Tenant, TenantMember, User, TenantMemberInvitation } from "../libs/prisma";
import AuthService from "./AuthService";
import TenantService from "./TenantService";
import Validater from "../helpers/Validater";
import UserService from "./UserService";

export default class TenantMemberService {
    static async getInvitationById(invitationId: string) : Promise<TenantMemberInvitation> {
        Validater.validateID(invitationId);

        const invitation = await prisma.tenantMemberInvitation.findUnique({
            where: {
                tenantMemberInvitationId: invitationId
            }
        });

        if (!invitation) {
            throw new Error("INVITATION_NOT_FOUND");
        }

        return invitation;

    }
    
    static async updateMembership(membership: TenantMember, roles: string[], status: string = "ACTIVE", force: boolean = false): Promise<TenantMember> {
        Validater.validateRoles(roles);
        Validater.validateStatus(status);

        const tenant = TenantService.getTenantById(membership.tenantId);

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        // check if roles are changed
        if (roles !== membership.roles) {
            // if user looses admin role then check if there is another admin
            if (roles.includes("ADMIN") && !membership.roles.includes("ADMIN")) {
                // Check if there is another admin
                const admins = await prisma.tenantMember.count({
                    where: {
                        tenantId: membership.tenantId,
                        roles: {
                            has: "ADMIN"
                        }
                    }
                });

                if (admins < 2 && !force) {
                    throw new Error("ONE_ADMIN_REQUIRED");
                }

            }

        }

        // check if status is changed
        if (status !== membership.status) {
            if (status === "INACTIVE") {
                // Check if there is another admin
                const admins = await prisma.tenantMember.count({
                    where: {
                        tenantId: membership.tenantId,
                        roles: {
                            has: "ADMIN"
                        }
                    }
                });

                if (admins < 2 && !force) {
                    throw new Error("ONE_ADMIN_REQUIRED");
                }
            }
        }

        return prisma.tenantMember.update({
            where: {
                tenantMemberId: membership.tenantMemberId
            },
            data: {
                roles,
                status
            }
        });
    }

    static async deleteMembership(membership: TenantMember): Promise<void> {
        await prisma.tenantMember.delete({
            where: {
                tenantMemberId: membership.tenantMemberId
            }
        });
    }


    static async getMembershipById(tenantMemberId: string): Promise<TenantMember> {
        Validater.validateID(tenantMemberId);

        const memebership = await prisma.tenantMember.findUnique({
            where: {
                tenantMemberId
            }
        });

        if (!memebership) {
            throw new Error("MEMBERSHIP_NOT_FOUND");
        }

        return memebership;
    }

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
                    status: "ACTIVE",
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
            roles = ["USER"];
        }

        if (typeof roles === "string") {
            roles = [roles];
        }


        Validater.validateRoles(roles);

        //if user roles include ADMIN then add ADMIN role to the membership
        if (user.roles.includes("ADMIN") && !roles.includes("ADMIN")) {
            roles.push("ADMIN");
        }


        if (!user) {
            throw new Error("USER_NOT_FOUND");
        }

        const existingMembership = await prisma.tenantMember.findFirst({
            where: {
                tenantId: tenant.tenantId,
                userId: user.userId
            }
        });

        if (existingMembership) {
            throw new Error("MEMBERSHIP_EXISTS");
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

    static async createMembershipWithUserEmail(tenant: Tenant, email: string, roles: string[] = ["USER"]): Promise<TenantMember> {
        Validater.validateEmail(email);

        const user = await UserService.getUserByEmail(email);

        return await this.createMembership(tenant, user, roles);
    }

    static async createMembershipWithUserId(tenant: Tenant, userId: string, roles: string[] = ["USER"]): Promise<TenantMember> {
        Validater.validateID(userId);

        const user = await UserService.getUserById(userId);

        return await this.createMembership(tenant, user, roles);
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

    static async inviteUser(tenant: Tenant, email: string): Promise<any> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        if (!email) {
            throw new Error("INVALID_EMAIL");
        }

        Validater.validateEmail(email);





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

        if (invitation.email !== user.email) {
            throw new Error("INVALID_INVITATION");
        }

        const membership = await TenantMemberService.createMembership(tenant, user, invitation.roles);

        await prisma.tenantMemberInvitation.delete({
            where: {
                tenantMemberInvitationId: invitationId
            }
        });

        return membership;
    }

    static async deleteInvitation(tenant: Tenant, invitationId: string): Promise<void> {

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

        await prisma.tenantMemberInvitation.delete({
            where: {
                tenantMemberInvitationId: invitationId
            }
        });

    }

    static async deleteInvitations(tenant: Tenant): Promise<void> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        await prisma.tenantMemberInvitation.deleteMany({
            where: {
                tenantId: tenant.tenantId
            }
        });

    }

    static async rejectInvitation(tenant: Tenant, user: User, invitationId: string): Promise<void> {

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

        if (invitation.email !== user.email) {
            throw new Error("INVALID_INVITATION");
        }

        await prisma.tenantMemberInvitation.delete({
            where: {
                tenantMemberInvitationId: invitationId
            }
        });

    }

}

