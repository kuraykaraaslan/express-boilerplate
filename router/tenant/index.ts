import { Router } from "express";

import tenantMemberRouter from "./tenant_member";
import tenantInvitationRouter from "./tenant_invitation";
import tenantDomainRouter from "./tenant_domain";
import tenantSettingRouter from "./tenant_setting";
import tenantSubscriptionRouter from "./tenant_subscription";
import webhookRouter from "./webhook";
import apiKeyRouter from "./api_key";
import tenantBrandingRouter from "./tenant_branding";
import tenantExportRouter from "./tenant_export";
import tenantSessionRouter from "./tenant_session";
import tenantUsageRouter from "./tenant_usage";

const tenantScopedRouter = Router({ mergeParams: true });

tenantScopedRouter.use("/members", tenantMemberRouter);
tenantScopedRouter.use("/invitations", tenantInvitationRouter);
tenantScopedRouter.use("/domains", tenantDomainRouter);
tenantScopedRouter.use("/settings", tenantSettingRouter);
tenantScopedRouter.use("/subscription", tenantSubscriptionRouter);
tenantScopedRouter.use("/webhooks", webhookRouter);
tenantScopedRouter.use("/api-keys", apiKeyRouter);
tenantScopedRouter.use("/branding", tenantBrandingRouter);
tenantScopedRouter.use("/export", tenantExportRouter);
tenantScopedRouter.use("/session", tenantSessionRouter);
tenantScopedRouter.use("/usage", tenantUsageRouter);

export default tenantScopedRouter;
