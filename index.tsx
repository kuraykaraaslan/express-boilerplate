// Express server
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import cors from "cors";
import logger from 'morgan';
import userRouter from "./routers/v1/UserRouter"
import ErrorHandler from "./middlewares/ErrorHandler";

import dotenv from "dotenv";
import V1Router from "./routers/v1";
dotenv.config({ path: "../.env" });


const app = express();
const host = process.env.EXPRESS_HOST || "http://localhost";
const port = process.env.EXPRESS_PORT || 3000;

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());


// Routes
app.use("/api/v1", V1Router);
app.use(ErrorHandler);

app.listen(port, () => {
  console.clear();
  console.log(`Server running at ${host}:${port}`);
});



module.exports = app;
