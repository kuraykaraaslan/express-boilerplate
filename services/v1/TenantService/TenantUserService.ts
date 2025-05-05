import prisma from './../../../libs/prisma';
import { TenantUser } from '@prisma/client';

// DTOs
import GetTenantUserRequest from './../../../dtos/requests/tenantuser/GetTenantUserRequest';
import GetTenantUsersRequest from './../../../dtos/requests/tenantuser/GetTenantUsersRequest';
import GetTenantUsersResponse from './../../../dtos/responses/tenantuser/GetTenantUsersResponse';
import PutTenantUserRequest from './../../../dtos/requests/tenantuser/PutTenantUserRequest';
import CreateTenantUserRequest from './../../../dtos/requests/tenantuser/CreateTenantUserRequest';

// Omit
import SafeTenantUser from './../../../types/SafeTenantUser';

export default class TenantUserService {

    /**
     * Error Messages
     * These are the error messages that can be thrown by the service.
     */
    static readonly TENANT_USER_NOT_FOUND = "TENANT_USER_NOT_FOUND";
    static readonly INVALID_TENANT_USER_REQUEST = "INVALID_TENANT_USER_REQUEST";

    /**
     * Select fields to be omitted from the tenant user object.
     */
    static readonly SafeTenantUserSelect = {
        tenantUserId: true,
        tenantId: true,
        userId: true,
        tenantUserRole: true,   
        tenantUserStatus: true
    };

    /**
     * Omit sensitive fields from the tenant object.
     * @param tenant - The user object.
     * @returns The tenant object without the deletedAt.
     */
    static omitSensitiveFields(tenantUser: TenantUser): SafeTenantUser
    {
        const omitted: SafeTenantUser = {
            tenantUserId: tenantUser.tenantUserId,
            tenantId: tenantUser.tenantId,
            userId: tenantUser.userId,
            tenantUserRole: tenantUser.tenantUserRole,
            tenantUserStatus: tenantUser.tenantUserStatus,
        };
        return omitted;
    }

    public static async getById(data: GetTenantUserRequest): Promise<SafeTenantUser | null> {


        const { tenantId , userId, tenantUserId } = data;

        // check if tenantId or userId is provided
        if (!tenantId && !userId) {
            throw new Error(TenantUserService.INVALID_TENANT_USER_REQUEST);
        }

        const tenantUser = await prisma.tenantUser.findFirst({
            where: {
                tenantId,
                userId,
                tenantUserId,
            }
        });

        if (!tenantUser) {
            return null;
        }

        return TenantUserService.omitSensitiveFields(tenantUser);

    }

    public static async getAll(data: GetTenantUsersRequest): Promise<GetTenantUsersResponse> {

        const { skip, take, search, tenantId , userId  } = data;

        const queryOptions = {
            skip,
            take,
            where: {
                name: search,
                tenantId,
                userId,
            }
        }; 

        const [tenantUsers, total] = await Promise.all([
            prisma.tenantUser.findMany(queryOptions),
            prisma.tenantUser.count({ where: queryOptions.where }),
        ]);

        const tenantUsersOmit = tenantUsers.map((tenantUser) => TenantUserService.omitSensitiveFields(tenantUser));

        return { tenantUsers: tenantUsersOmit, total };
       
    }

    /**
     * Delete a tenant user.
     * @param data - The tenant user data.
     * @returns The tenant user.
     * @throws TENANT_USER_NOT_FOUND
     * @throws INVALID_TENANT_USER_REQUEST
     */
    public static async delete(data: GetTenantUserRequest): Promise<SafeTenantUser> {
        const { tenantId, userId, tenantUserId } = data;

        // check if tenantId or userId is provided
        if (!tenantId && !userId) {
            throw new Error(TenantUserService.INVALID_TENANT_USER_REQUEST);
        }

        const tenantUser = await prisma.tenantUser.delete({
            where: {
                tenantId,
                userId,
                tenantUserId,
            }
        });

        return TenantUserService.omitSensitiveFields(tenantUser);
    }

    /**
     * Update a tenant user.
     * @param data - The tenant user data.
     * @returns The tenant user.
     * @throws TENANT_USER_NOT_FOUND
     * @throws INVALID_TENANT_USER_REQUEST
     */
    public static async update(data: PutTenantUserRequest): Promise<SafeTenantUser> {
        const { tenantUserId, tenantUserRole, tenantUserStatus } = data;

        if (!tenantUserId) {
            throw new Error(TenantUserService.INVALID_TENANT_USER_REQUEST);
        }

        const tenantUser = await prisma.tenantUser.update({
            where: {
                tenantUserId,
            },
            data: {
                tenantUserRole,
                tenantUserStatus,
            }
        });

        return TenantUserService.omitSensitiveFields(tenantUser);
    }

    /**
     * Create a new tenant user.
     * @param data - The tenant user data.
     * @returns The created tenant user.
     * @throws INVALID_TENANT_USER_REQUEST
     */
    public static async create(data: CreateTenantUserRequest): Promise<SafeTenantUser> {
        const { tenantId, userId, tenantUserRole, tenantUserStatus } = data;

        if (!tenantId || !userId || !tenantUserRole || !tenantUserStatus) {
            throw new Error(TenantUserService.INVALID_TENANT_USER_REQUEST);
        }

        const tenantUser = await prisma.tenantUser.create({
            data
        });

        return TenantUserService.omitSensitiveFields(tenantUser);
    }

    /**
     * checkIfUserHasRole
     */
    public static checkIfUserHasRole(tenantUser: SafeTenantUser, requiredRole: string): boolean {
        const roles = [
            'ADMIN',
            'USER',
        ];

        const roleIndex = roles.indexOf(requiredRole);
        const userRoleIndex = roles.indexOf(tenantUser.tenantUserRole);

        return roleIndex <= userRoleIndex;

    }
    

}


