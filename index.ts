import 'module-alias/register';
import './bootstrap/global-errors';
import express, { Request, Response, Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";
//import csrf from "csurf";

import errorHandler from "./src/shared/middleware/errorHandler";
import Logger from "./src/shared/libs/logger";
import Limiter from "./src/shared/libs/limiter";
import prisma from './src/shared/libs/prisma';
import redisInstance from './src/shared/libs/redis';

// Routers
import userRouter from "./src/user/router";
import authRouter from "./src/auth/router"
import tenantRouter from "./src/tenant/router";
import tenantUserRouter from './src/tenantUser/router';

dotenv.config();

const app = express();

// Gerekli middleware’leri sırayla kur
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

/*
const csrfProtection = csrf({
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict", // veya "lax" frontend'e göre
      maxAge: 60 * 60 * 24 * 7,
    }
  });

app.use(csrfProtection);
*/

const port = process.env.PORT || process.env.APPLICATION_PORT || 3002;

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
    origin: process.env.CORS_ORIGIN || "http://localhost:3002",
    credentials: true,
}));




// --- Logging & Rate Limiting ---
app.use(Logger.useLogger);
app.use(Limiter.useLimiter);

// --- Views ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// --- Routes ---

const router = Router();
router.use("/auth", authRouter);
router.use("/tenant", tenantRouter);
router.use("/tenantUser", tenantUserRouter);
router.use("/user", userRouter);


app.use("/api", router);


// --- Welcome Route ---
app.get("/", (request: Request, response: Response) => {
    response.json({
        message: "Welcome to the API",
        version: process.env.npm_package_version,
        env: process.env.NODE_ENV,
        csrfToken: request.csrfToken(),
        csrfCookie: request.cookies["XSRF-TOKEN"],
        csrfHeader: request.headers["x-xsrf-token"],
    });
});

// --- Health Check Route ---
app.get("/health", async (request: Request, response: Response) => {

    const redisStatus = await redisInstance.ping()
        .then(() => true)
        .catch(() => false);
    const dbStatus = await prisma.$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false);
    const serverStatus = true;
    const status = redisStatus && dbStatus && serverStatus;

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
        console.log(`🚀 Server is running on port ${port}`);
        if (!process.env.JWT_SECRET || !process.env.DB_URL) {
            console.warn("⚠️  WARNING: Missing critical environment variables.");
        }
    });
}

module.exports = app;
export default app;
