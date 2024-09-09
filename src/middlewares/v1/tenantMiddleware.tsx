/*
    This middleware is used to check if the user is authenticated and has the required role
    If the user is not authenticated, it will return 401
    If the user is authenticated but does not have the required role, it will return 401
    If the user is authenticated and has the required role, it will call the next middleware
    Default required role is 'USER'
*/
import express, { NextFunction } from 'express';
import Response from '../../response/Response';
import Request from '../../request/Request';
import Logger from '../../helpers/Logger';
import { Tenant, TenantMember } from '../../libs/prisma';

import TenantService from '../../services/TenantService';
import TenantMemberService from '../../services/TenantMemberService';

import errorHandlerWrapper from '../../utils/errorHandlerWrapper';

const tenantMiddleware = function (incomingReqRoles?: string | string[] | undefined) {


  return errorHandlerWrapper(

    async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {

      var requiredRoles = incomingReqRoles ? typeof incomingReqRoles === 'string' ? [incomingReqRoles] : incomingReqRoles : ['USER'];

      //if we have tenant and tenantMember already in the request, it means we have already checked the user, so it will be elavation of privilages
      if (req.tenant && req.tenantMember) {
        //check if the user has the required role
        
        if (!TenantMemberService.checkIfMemberHasRole(req.tenant, req.tenantMember, requiredRoles)) {
          Logger.error("[AUTH] User does not have required role for Route: " + req.originalUrl, req, res);
          return res.status(401).json({ message: "UNAUTHORIZED_ACCESS" });
        }
                
        Logger.info("[AUTH] [ELEVATION OF PRIVILAGES] User authenticated for Route: " + req.originalUrl, req, res);
        return next();
      }

  
      const tenantIdByParam = req.params.tenantId as string;
      // Allow guest if token is not present
      if (requiredRoles.length === 0 || requiredRoles.includes('GUEST')) {
        Logger.info("[AUTH] Guest allowed for Route: " + req.originalUrl, req, res);
        return next();
      }
      const tenant = await TenantService.getTenantById(tenantIdByParam);
      if (!tenant) {
        Logger.error("[AUTH] Tenant not found for Route: " + req.originalUrl, req, res);
        return res.status(404).json({ message: "TENANT_NOT_FOUND" });
      }
      req.tenant = tenant;

      var tenantMember = await TenantMemberService.getMembership(tenant, req.user);

      if (!tenantMember) {
        Logger.error("[AUTH] Tenant Member not found for Route: " + req.originalUrl, req, res);
        return res.status(404).json({ message: "MEMBERSHIP_NOT_FOUND" });
      }

      req.tenantMember = tenantMember as TenantMember;

      // Check if the user has the required roles
      if (!TenantMemberService.checkIfMemberHasRole(req.tenant, req.tenantMember, requiredRoles)) {
        Logger.error("[AUTH] User does not have the required roles for Route: " + req.originalUrl, req, res);
        return res.status(401).json({ message: "UNAUTHORIZED_ACCESS" });
      }
      
      next();
    }
  );
}

export default tenantMiddleware;