import 'module-alias/register';
import './bootstrap/global-errors';
import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";
import csrf from "csurf";

import errorHandler from "./middlewares/v1/errorHandler";
import IndexRouter from "./routers";

import Logger from "./libs/logger";
import Limiter from "./libs/limiter";

dotenv.config();

const app = express();

// Gerekli middleware’leri sırayla kur
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

// CSRF middleware’i cookie ile çalışacak şekilde tanımla
const csrfProtection = csrf({
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict", // veya "lax" frontend'e göre
      maxAge: 60 * 60 * 24 * 7,
    }
  });
/*
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
app.use("/", IndexRouter);



// --- Welcome Route ---
app.get("/", (request: Request, response: Response) => {
    response.send("Welcome to the Express server!");
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
