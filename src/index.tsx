// Express server
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
//import logger from 'morgan';
import gatewayMiddleware from "./middlewares/gatewayMiddeware";
import cors from "cors";

// Main router
import mainRouter from "./routers";
import Logger from "./helpers/Logger";

//dot env
import dotenv from "dotenv";

const NODE_ENV = process.env.NODE_ENV || "development";

if (NODE_ENV === "development") {
  dotenv.config({ path: path.resolve(__dirname, "../.env.development") });
} else {
  dotenv.config({ path: "../.env.production" });
}

const app = express();
const host = process.env.EXPRESS_HOST || "http://localhost";
const port = process.env.EXPRESS_PORT || 3000;

//app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());

// Middlewares
app.use(gatewayMiddleware);

app.use("/.env", (req, res) => {
  res.status(404).send("Fuck off");
});

// Routes
app.use("/", mainRouter);

app.listen(port, () => {
  console.clear();
  Logger.operation("[EXPRESS] Server is running on " + host + ":" + port);
});

module.exports = app;
