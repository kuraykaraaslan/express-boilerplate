import prisma from '../libs/prisma';
import { Tenant } from '@prisma/client';

import GetTenantRequest from '../dtos/requests/tenant/GetTenantRequest';
import TenantOmit from '../types/TenantOmit';
import CreateTenantRequest from '../dtos/requests/tenant/CreateTenantRequest';
import PutTenantRequest from '../dtos/requests/tenant/PutTenantRequest';
import GetTenantsRequest from '@/dtos/requests/tenant/GetTenantsRequest';
import GetTenantsResponse from '@/dtos/responses/tenant/GetTenantsResponse';

export default class TenantService {

    /**
     * Error Messages
     * These are the error messages that can be thrown by the service.
     */
    static TENANT_NOT_FOUND = "TENANT_NOT_FOUND";
    static INVALID_TENANT_REQUEST = "INVALID_TENANT_REQUEST";

    /**
     * Omit sensitive fields from the tenant object.
     * @param tenant - The user object.
     * @returns The tenant object without the deletedAt.
     */
    static omitSensitiveFields(tenant: Tenant): TenantOmit
    {
        const omitted: TenantOmit = {
            tenantId: tenant.tenantId,
            domain: tenant.domain,
            name: tenant.name,
            tenantStatus: tenant.tenantStatus,
        };

        return omitted;
    }

    /**
     * Get all tenants.
     * @returns The tenants.
     */
    public static async getAll(data: GetTenantsRequest): Promise<GetTenantsResponse> {
        const { skip, take, search  } = data;

        console.log(data);

        const queryOptions = {
            skip,
            take,
            where: {
                OR: [
                    {
                        domain: {
                            contains: search
                        }
                    },
                    {
                        name: {
                            contains: search
                        }
                    }
                ]
            }
        }; 

        const [tenants, total] = await Promise.all([
            prisma.tenant.findMany(queryOptions),
            prisma.tenant.count({ where: queryOptions.where }),
        ]);

        const tenantsOmit = tenants.map((tenant) => TenantService.omitSensitiveFields(tenant));

        return { tenants: tenantsOmit, total };
    }

    /**
     * Get a tenant by ID.
     * @param data - The tenant data.
     * @returns The tenant.
     */      

    public static async getById(data: GetTenantRequest): Promise<TenantOmit> {

        const { tenantId , domain } = data;


        console.log('tenantId:', tenantId);
        let tenant = await prisma.tenant.findFirst({
            where: {
                OR: [
                    {
                        tenantId
                    },
                    {
                        domain
                    }
                ]
            }
        });

        if (!tenant) {
            throw new Error(TenantService.TENANT_NOT_FOUND);
        }

        return TenantService.omitSensitiveFields(tenant);

    }

    /**
     * Create a new tenant.
     * @param data - The tenant data.
     * @returns The created tenant.
     */
    public static async create(data: CreateTenantRequest): Promise<TenantOmit> {
        let tenant = await prisma.tenant.create({
            data
        });

        return TenantService.omitSensitiveFields(tenant);
    }

    /**
     * Update a tenant.
     * @param data - The tenant data.
     * @returns The updated tenant.
     */
    public static async update(data: PutTenantRequest): Promise<TenantOmit> {
        let tenant = await prisma.tenant.update({
            where: {
                tenantId: data.tenantId
            },
            data
        });

        return TenantService.omitSensitiveFields(tenant);
    }

    /**
     * Delete a tenant.
     * @param data - The tenant data.
     * @returns The deleted tenant.
     */
    public static async delete(data: GetTenantRequest): Promise<TenantOmit> {
        let tenant = await prisma.tenant.delete({
            where: {
                tenantId: data.tenantId
            }
        });

        if (!tenant) {
            throw new Error(TenantService.TENANT_NOT_FOUND);
        }

        return TenantService.omitSensitiveFields(tenant);   
    }

}


