import "@/../bootstrap/global-errors";
import express, { Request, Response, Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import { errorHandler } from "@/libs/middleware/error-handler";
import Logger from "@/libs/logger";
import Limiter from "@/libs/limiter";
import redis from "@/libs/redis";
import { AppDataSource } from "@/libs/typeorm";
import { env } from "@/libs/env";

import userRouter from "@/modules/user/router";
import authRouter from "@/modules/auth/router";
import tenantRouter from "@/modules/tenant/router";
import tenantMemberRouter from "@/modules/tenant_member/router";
import tenantInvitationRouter from "@/modules/tenant_invitation/router";
import tenantDomainRouter from "@/modules/tenant_domain/router";
import tenantSettingRouter from "@/modules/tenant_setting/router";
import tenantSubscriptionRouter from "@/modules/tenant_subscription/router";
import paymentRouter from "@/modules/payment/router";
import webhookRouter from "@/modules/webhook/router";
import apiKeyRouter from "@/modules/api_key/router";
import couponRouter from "@/modules/coupon/router";
import storageRouter from "@/modules/storage/router";
import userProfileRouter from "@/modules/user_profile/router";
import userPreferencesRouter from "@/modules/user_preferences/router";
import userSecurityRouter from "@/modules/user_security/router";
import tenantBrandingRouter from "@/modules/tenant_branding/router";
import tenantExportRouter from "@/modules/tenant_export/router";
import tenantSessionRouter from "@/modules/tenant_session/router";
import tenantUsageRouter from "@/modules/tenant_usage/router";

dotenv.config();

const app = express();

// Gerekli middleware'leri sırayla kur
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

const port = env.PORT;

// --- Security Headers ---
app.use(
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'"],
        },
    })
);
app.use(helmet.crossOriginResourcePolicy({ policy: "same-origin" }));
app.use(helmet.crossOriginEmbedderPolicy({ policy: "require-corp" }));
app.enable('trust proxy');

app.use(cors({
    origin: env.CORS_ORIGIN || "http://localhost:3002",
    credentials: true,
}));

// --- Logging & Rate Limiting ---
app.use(Logger.useLogger);
app.use(Limiter.useLimiter);

// --- Routes ---

// System routes
const systemRouter = Router();
systemRouter.use("/auth", authRouter);
systemRouter.use("/users", userRouter);
systemRouter.use("/users/me/profile", userProfileRouter);
systemRouter.use("/users/me/preferences", userPreferencesRouter);
systemRouter.use("/users/me/security", userSecurityRouter);
systemRouter.use("/payments", paymentRouter);
systemRouter.use("/coupons", couponRouter);
systemRouter.use("/storage", storageRouter);

// Tenant routes (/:tenantId ile)
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

// Mount
app.use("/api/v1/system", systemRouter);
app.use("/api/v1/tenant/:tenantId", tenantScopedRouter);
app.use("/api/v1/system/tenants", tenantRouter);

// --- Welcome Route ---
app.get("/", (request: Request, response: Response) => {
    response.json({
        message: "Welcome to the API",
        version: process.env.npm_package_version,
        env: process.env.NODE_ENV,
    });
});

// --- Health Check Route ---
app.get("/health", async (request: Request, response: Response) => {
    const redisStatus = await redis.ping()
        .then(() => true)
        .catch(() => false);
    const dbStatus = await AppDataSource.query('SELECT 1')
        .then(() => true)
        .catch(() => false);
    const serverStatus = true;

    response.status(200).json({
        message: "OK",
        databaseStatus: dbStatus ? "OK" : "ERROR",
        redisStatus: redisStatus ? "OK" : "ERROR",
        serverStatus: serverStatus ? "OK" : "ERROR",
    });
});

// --- Error Handling ---
app.use(errorHandler);

// --- Start Server ---
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
        if (!process.env.JWT_SECRET || !process.env.DB_URL) {
            console.warn("WARNING: Missing critical environment variables.");
        }
    });
}

module.exports = app;
export default app;
