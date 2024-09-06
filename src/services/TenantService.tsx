import prisma, { Tenant, TenantSetting, User, TenantMember } from "../libs/prisma";
import TenantMemberService from "./TenantMemberService";

export default class TenantService {
    static getTenantById: any;

    static validateDomain(domain: string): void {
        // Validate domain can only contain alphanumeric characters, underscores, and hyphens, no spaces, no special characters
        const regex = /^[a-zA-Z0-9_\-]+$/;
        if (!domain.match(regex)) {
            throw new Error("INVALID_DOMAIN");
        }
        return;
    }

    static validateName(name: string): void {
        if (!name) {
            throw new Error("INVALID_NAME");
        }

        const regex = /^[a-zA-Z0-9_\-]+$/;
        if (!name.match(regex)) {
            throw new Error("INVALID_NAME");
        }
        return;
    }

    static async listAllTenants(page: number, pageSize: number): Promise<any> {
        return prisma.$transaction([
            prisma.tenant.findMany({
                skip: page * pageSize,
                take: pageSize,
            }),
            prisma.tenant.count(),
        ])
        .then((query) => {
            return {
                tenants: query[0],
                total: query[1],
                page,
                pageSize,
            };
        });
    }


    static async getTenantFromDomain(domain: string): Promise<Tenant> {

        this.validateDomain(domain);

        const tenant = await prisma.tenant.findFirst({
            where: {
                domain
            }
        });

        if (!tenant) {
            throw new Error("TENANT_NOT_FOUND");
        }

        return tenant;
    }

    static async createTenant(domain: string, name: string): Promise<Tenant> {

        this.validateDomain(domain);
        this.validateName(name);

        const existingTenant = await prisma.tenant.findFirst({
            where: {
                domain
            }
        });

        if (existingTenant) {
            throw new Error("TENANT_EXISTS");
        }

        const tenant = await prisma.tenant.create({
            data: {
                domain,
                name
            }
        });

        return tenant;
    }

    static async createTenantWithAdmin(domain: string, name: string, user: User): Promise<{ tenant: Tenant, membership: TenantMember }> {

        this.validateDomain(domain);
        this.validateName(name);

        const existingTenant = await prisma.tenant.findFirst({
            where: {
                domain
            }
        });

        if (existingTenant) {
            throw new Error("TENANT_EXISTS");
        }

        const tenant = await this.createTenant(domain, name);

        const membership = await TenantMemberService.createMembership(tenant, user, ["USER", "ADMIN"]);

        return {
            tenant,
            membership
        };
    }



}