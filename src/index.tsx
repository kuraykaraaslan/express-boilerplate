// Express server
import express , { Request, Response } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import errorMiddleware from './middlewares/errorMiddleware';
import gatewayMiddleware from './middlewares/gatewayMiddeware';
import cors from 'cors';

// Main router
import mainRouter from './routers';
import Logger from './helpers/Logger';


const app = express();
const host = process.env.EXPRESS_HOST || 'http://localhost';
const port = process.env.EXPRESS_PORT || 3000;


//app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());


// Middlewares
app.use(gatewayMiddleware);

// Routes
app.use('/', mainRouter);



app.listen(port, () => {
  console.clear();
  Logger.operation("[EXPRESS] Server is running on " + host + ":" + port);
});


module.exports = app;
