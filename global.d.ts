import "express";

declare global {
  namespace Express {
    interface Request {
      user?: import("@/modules/user/user.types").SafeUser;
      userSession?: import("@/modules/user_session/user_session.types").SafeUserSession;
      tenantMember?: import("@/modules/tenant_member/tenant_member.types").SafeTenantMember;
    }
  }
}
