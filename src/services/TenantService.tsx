import prisma, { Tenant, TenantSetting, User, TenantMember } from "../libs/prisma";
import TenantMemberService from "./Tenant/TenantMemberService";
import Validater from "../helpers/Validater";

export default class TenantService {

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

    static async getTenantByURL(urlString: string): Promise<Tenant> {

        try {
            //add https if not present
            if (!urlString.startsWith("http")) {
                urlString = "https://" + urlString;
            }

            const url = new URL(urlString);

            const FRONTEND_URL = process.env.FRONTEND_URL || "https://localhost:3000";

            const subdomain = url.hostname.replace("." + new URL(FRONTEND_URL).hostname, "");

            return this.getTenantByDomain(subdomain);

        } catch (error) {
            throw new Error("INVALID_URL");
        }


    }


    static async getTenantByDomain(domain: string): Promise<Tenant> {

        Validater.validateDomain(domain);

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

    static async getTenantById(tenantId: string): Promise<Tenant> {

        if (!tenantId) {
            throw new Error("INVALID_TENANT_ID");
        }

        const tenant = await prisma.tenant.findUnique({
            where: {
                tenantId: tenantId
            }
        });

        if (!tenant) {
            throw new Error("TENANT_NOT_FOUND");
        }

        return tenant;
    }

    static async createTenant(domain: string, name: string): Promise<Tenant> {

        Validater.validateDomain(domain);
        Validater.validateName(name);

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

        Validater.validateDomain(domain);
        Validater.validateName(name);

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


    static async updateTenant(tenantId: string, data: any): Promise<Tenant> {

        Validater.validateID(tenantId);
        Validater.validateName(data.name);
        Validater.validateDomain(data.domain);
        Validater.validateURL(data.logo, true);
        Validater.validateURL(data.favicon, true);
        Validater.validateStringField(data.theme, "theme", true);
        Validater.validateStringField(data.timezone, "timezone", true);

        if (!tenantId) {
            throw new Error("INVALID_TENANT_ID");
        }

        const tenant = await prisma.tenant.findUnique({
            where: {
                tenantId: tenantId
            }
        });

        if (!tenant) {
            throw new Error("TENANT_NOT_FOUND");
        }

    
        //if data has created at or updated at, remove them
        delete data.createdAt;
        delete data.updatedAt;

        const updatedTenant = await prisma.tenant.update({
            where: {
                tenantId: tenantId
            },
            data: {
                ...data,
                updatedAt: new Date()
            }
        });

        return updatedTenant;
    }

    static async deleteTenant(tenantId: string): Promise<Tenant> {

        Validater.validateID(tenantId);

        if (!tenantId) {
            throw new Error("INVALID_TENANT_ID");
        }

        const tenant = await prisma.tenant.findUnique({
            where: {
                tenantId: tenantId
            }
        });

        if (!tenant) {
            throw new Error("TENANT_NOT_FOUND");
        }

        await prisma.tenant.delete({
            where: {
                tenantId: tenantId
            }
        });

        return tenant;
    }



}