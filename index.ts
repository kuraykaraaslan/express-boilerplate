import "@/modules/common/app-error";
import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import { errorHandler } from "@/modules_express/common/error-handler.middleware";
import Logger from "@/modules_express/logger/logger.service.express";
import Limiter from "@/modules_express/limiter/limiter.service.express";
import redis from "@/modules/redis";
import { SystemDataSource } from "@/modules/db/db.system";
import { env } from "@/modules/env";

import proxyRouter from "@/router";

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
app.use(proxyRouter);

// --- Welcome Route ---
app.get("/", (_req: Request, response: Response) => {
    response.json({
        message: "Welcome to the API",
        version: process.env.npm_package_version,
        env: process.env.NODE_ENV,
    });
});

// --- Health Check Route ---
app.get("/health", async (_req: Request, response: Response) => {
    const redisStatus = await redis.ping()
        .then(() => true)
        .catch(() => false);
    const dbStatus = await SystemDataSource.query('SELECT 1')
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
