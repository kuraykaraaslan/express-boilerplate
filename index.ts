// Express server
//import 'tsconfig-paths/register';
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import errorHandler from "./middlewares/v1/errorHandler";

import dotenv from "dotenv";
import IndexRouter from "./routers";
dotenv.config({ path: "../.env" });

import path from "path";
import Logger from "./libs/logger";
import Limiter from "./libs/limiter";
import bodyParser from "body-parser";


const app = express();
const host = process.env.APPLICATION_HOST ? process.env.APPLICATION_HOST.split(":")[1] : "http://localhost";
const port = process.env.APPLICATION_PORT || 3001;

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


// HTTPS or HTTP
app.listen(port, () => {
    console.clear();
    console.log(`Server started at ${host}:${port}`);
});

module.exports = app;
