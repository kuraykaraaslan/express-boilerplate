import 'module-alias/register';
import './bootstrap/global-errors'; // ✅ AppError global'e atanıyor
import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";

import errorHandler from "./middlewares/v1/errorHandler";
import IndexRouter from "./routers";

import Logger from "./libs/logger";
import Limiter from "./libs/limiter";



dotenv.config();

const app = express();
const port = process.env.PORT || process.env.APPLICATION_PORT || 3002;

// --- Security Middlewares ---
app.use(helmet());
app.enable('trust proxy');

// --- Logging & Rate Limiting ---
app.use(Logger.useLogger);
app.use(Limiter.useLimiter);


// --- Body Parsers (limit to avoid large body attacks) ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

// --- Cookies & CORS ---
app.use(cookieParser());
app.use(cors({
    origin: process.env.CORS_ORIGIN || "*", // Set specific origins for production
    credentials: true
}));

// --- Views ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// --- Routes ---
app.use("/", IndexRouter);

// --- Welcome Route (optional if IndexRouter handles "/") ---
app.get("/", (req: Request, res: Response) => {
    res.send("Welcome to the Express server!");
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
