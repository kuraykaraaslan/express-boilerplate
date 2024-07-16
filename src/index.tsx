// Express server
import express , { Request, Response } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';

// Routes
import { ExpressAuth } from "@auth/express"
import AuthRouter from './routers/AuthRouter';

const app = express();
const port = process.env.EXPRESS_PORT || 3000;

app.use(logger('dev'));
app.set("trust proxy", true);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Routes

app.use('/auth', AuthRouter);


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
