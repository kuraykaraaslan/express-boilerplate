import { ExpressAuth } from "@auth/express"
import AuthConfig from "../config/AuthConfig";
import express from "express"

const AuthRouter = express.Router();

AuthRouter.use('/', ExpressAuth(AuthConfig))

export default AuthRouter;