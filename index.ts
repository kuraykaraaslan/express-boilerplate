import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import bodyParser from "body-parser";

import { errorHandler } from "@/modules_express/common/error-handler.middleware";
import Logger from "@/modules_express/logger/logger.service.express";
import Limiter from "@/modules_express/limiter/limiter.service.express";
import redis from "@/modules/redis";
import { SystemDataSource } from "@/modules/db/db.system";
import { env } from "@/modules/env";

import proxyRouter from "@/router";

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
    origin: env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
}));

// --- Logging & Rate Limiting ---
app.use(Logger.useLogger);
app.use(Limiter.useLimiter);

// --- Routes ---
app.use(proxyRouter);

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
