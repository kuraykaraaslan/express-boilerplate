// Express server
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import logger from 'morgan';
import ErrorHandler from "./middlewares/ErrorHandler";

import dotenv from "dotenv";
import IndexRouter from "./routers";
dotenv.config({ path: "../.env" });

import path from "path";


const app = express();
const host = process.env.APPLICATION_HOST ? process.env.APPLICATION_HOST.split(":")[1] : "http://localhost:3000";
const port = process.env.APPLICATION_PORT || 3000;

app.enable('trust proxy');
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());

//Set ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');


// Routes
app.use("/", IndexRouter);
app.use(ErrorHandler);


// HTTPS or HTTP
app.listen(port, () => {
    console.clear();
    console.log(`Server started at ${host}:${port}`);
});

module.exports = app;
