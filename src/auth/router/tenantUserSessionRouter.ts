// routers/v1/authRouter/tenantAuthRouter.ts

import { Router, Request, Response } from 'express';

// Middlewares
import tenantMiddleware from '../../tenantAuth/middleware';

// Services
import TenantUserService from '../../tenantUser/services';

// DTOs
import GetTenantUserRequest from '../../tenantUser/dtos/requests/GetTenantUserRequest';
import TenantUserSessionService from '../../tenantAuth/services/TenantAuthService';

const tenantUserSessionRouter = Router({ mergeParams: true });

/**
 * POST /v1/auth/session/tenant
 * Register Session for TenantUser
 * @param {string} tenantUserId - TenantUser ID
 */
tenantUserSessionRouter.post('/', async (request: Request, response: Response) => {
  
  const { tenantUserId } = request.body;

  const userSession = request.userSession;
  const accessToken = request.cookies.accessToken;

  if (!userSession || !accessToken) {
    throw new Error("USER_SESSION_OR_ACCESS_TOKEN_NOT_FOUND");
  }

  const getTenantUserRequest = new GetTenantUserRequest({
    tenantUserId,
    userId: userSession.userId,
  });
  

  const tenantUser = await TenantUserService.getById(getTenantUserRequest);

  if (!tenantUser) {
    throw new Error("TENANT_USER_NOT_FOUND");
  }

  const tenantUserSession = await TenantUserSessionService.setUserSessionTenantUser({
    tenantUser,
    userSession
  });

  if (!tenantUserSession) {
    throw new Error("TENANT_USER_SESSION_NOT_REGISTERED");
  }
 
  response.json({ message: "Tenant user session registered successfully" });
});



tenantUserSessionRouter.use(tenantMiddleware("USER"));

/**
 * GET /v1/auth/session/tenant
 * Stores SafeTenantUser in Redis using accessToken
 */
tenantUserSessionRouter.get('/', async (request: Request, response: Response) => {
  
  const tenantUser = request.tenantUser;

  response.status(200).json({ tenantUser });

});
  

export default tenantUserSessionRouter;
