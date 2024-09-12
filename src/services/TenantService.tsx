import prisma, { Tenant, TenantSetting, User, TenantMember } from "../libs/prisma";
import TenantMemberService from "./TenantMemberService";
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



}