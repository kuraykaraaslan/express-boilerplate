// Express server
import 'module-alias/register'; // ✅ BUNU YAZ
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import errorHandler from "./middlewares/v1/errorHandler";

import dotenv from "dotenv";
import IndexRouter from "./routers";
dotenv.config();

import path from "path";
import Logger from "./libs/logger";
import Limiter from "./libs/limiter";
import bodyParser from "body-parser";

const app = express();
const port = process.env.PORT || process.env.APPLICATION_PORT || 3001;

app.enable('trust proxy');
app.use(Logger.useLogger);
app.use(Limiter.useLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));


//Set ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Routes
app.use("/", IndexRouter);

//givewelcome on request

app.get("/", (req, res) => {
    res.send("Welcome to the Express server!");
});

app.use(errorHandler);

// Only start the server if not running on Vercel
app.listen(port, () => {
    console.clear();
    console.log(`Server started at port ${port}`);
});


module.exports = app;
