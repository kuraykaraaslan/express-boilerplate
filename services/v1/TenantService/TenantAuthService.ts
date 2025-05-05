import prisma from "../../../libs/prisma";
import TenantService from "../TenantService";
import SafeTenantUser from "../../../types/SafeTenantUser";

export default class TenantAuthService {

    static readonly SafeTenantSelect = TenantService.SafeTenantSelect;
    static readonly TENANT_USER_NOT_FOUND = "TENANT_USER_NOT_FOUND";
    static readonly INVALID_TENANT_USER_REQUEST = "INVALID_TENANT_USER_REQUEST";
    static readonly INVALID_TENANT_USER_SESSION_REQUEST = "INVALID_TENANT_USER_SESSION_REQUEST";


    static async setUserSessionTenantUser(data: { tenantUser: SafeTenantUser, accessToken: string }): Promise<boolean> {

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

  
        return true;

    }


}

        