// Express server
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import logger from 'morgan';
import ErrorHandler from "./middlewares/ErrorHandler";

import dotenv from "dotenv";
import V1Router from "./routers/v1";
import IndexRouter from "./routers";
dotenv.config({ path: "../.env" });


const app = express();
const host = process.env.APPLICATION_HOST || "http://localhost";
const port = process.env.APPLICATION_PORT || 3000;

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());


// Routes
app.use("/" , IndexRouter);
app.use(ErrorHandler);

app.listen(port, () => {
  console.clear();
  console.log(`Server running at ${host}:${port}`);
});



module.exports = app;
