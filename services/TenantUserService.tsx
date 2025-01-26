import prisma from '../libs/prisma';
import { TenantUser } from '@prisma/client';

import GetTenantUserRequest from '../dtos/requests/tenantuser/GetTenantUserRequest';
import GetTenantUserResponse from '../dtos/responses/tenantuser/GetTenantUserResponse';

import TenantUserOmit from '../types/TenantUserOmit';

export default class TenantUserService {

    /**
     * Error Messages
     * These are the error messages that can be thrown by the service.
     */
    static TENANT_USER_NOT_FOUND = "TENANT_USER_NOT_FOUND";
    static INVALID_TENANT_USER_REQUEST = "INVALID_TENANT_USER_REQUEST";

    /**
     * Omit sensitive fields from the tenant object.
     * @param tenant - The user object.
     * @returns The tenant object without the deletedAt.
     */
    static omitSensitiveFields(tenantUser: TenantUser): TenantUserOmit
    {
        const omitted: TenantUserOmit = {
            tenantUserId: tenantUser.tenantUserId,
            tenantId: tenantUser.tenantId,
            userId: tenantUser.userId,
            tenantUserRole: tenantUser.tenantUserRole,
            tenantUserStatus: tenantUser.tenantUserStatus,
        };
        return omitted;
    }

    public static async get(data: GetTenantUserRequest): Promise<TenantUserOmit> {


        const { tenantId , userId } = data;

        // check if tenantId or userId is provided
        if (!tenantId && !userId) {
            throw new Error(TenantUserService.INVALID_TENANT_USER_REQUEST);
        }

        let tenantUser = await prisma.tenantUser.findFirst({
            where: {
                tenantId,
                userId
            }
        });

        if (!tenantUser) {
            throw new Error(TenantUserService.TENANT_USER_NOT_FOUND);
        }

        return TenantUserService.omitSensitiveFields(tenantUser);

    }

    /**
     * Create a new tenant user.
     */

}


