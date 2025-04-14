import prisma from "../../../libs/prisma";
import { TenantUser, UserSession } from "@prisma/client";
import GetTenantUsersRequest from "../../../dtos/requests/tenantuser/GetTenantUsersRequest";
import GetTenantUsersResponse from "../../../dtos/responses/tenantuser/GetTenantUsersResponse";

import AuthService from ".";
import TenantService from "../TenantService";
import TenantUserOmit from "../../../types/TenantUserOmit";

export default class TenantAuthService {

    static readonly UserOmitSelect = AuthService.UserOmitSelect;
    static readonly TenantOmitSelect = TenantService.TenantOmitSelect;

    static readonly TENANT_USER_NOT_FOUND = "TENANT_USER_NOT_FOUND";
    static readonly INVALID_TENANT_USER_REQUEST = "INVALID_TENANT_USER_REQUEST";
    static readonly INVALID_TENANT_USER_SESSION_REQUEST = "INVALID_TENANT_USER_SESSION_REQUEST";

    static async setUserSessionTenantUser(data: { tenantUser: TenantUserOmit, accessToken: string }): Promise<boolean> {

        const { tenantUser, accessToken } = data;

        // check if tenantUser is provided
        if (!tenantUser) {
            throw new Error(this.INVALID_TENANT_USER_SESSION_REQUEST);
        }

        const userSession = await prisma.userSession.findFirst({
            where: {
                accessToken,
            }
        });            

        // check if userSession is provided
        if (!userSession) {
            throw new Error(this.INVALID_TENANT_USER_SESSION_REQUEST);
        }

        //check if tenantUser.userId is equal to userSession.userId
        if (tenantUser.userId !== userSession.userId) {
            throw new Error(this.INVALID_TENANT_USER_SESSION_REQUEST);
        }

        await prisma.userSession.update({
            where: {
                accessToken: userSession.accessToken,
            },
            data: {
                tenantUserId: tenantUser.tenantUserId,
                tenantId: tenantUser.tenantId,
            }
        });

        return true;

    }


}

        