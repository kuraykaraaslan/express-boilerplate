import { Router } from "express";

import userRouter from "./user";
import authRouter from "./auth";
import tenantRouter from "./tenant";
import paymentRouter from "./payment";
import couponRouter from "./coupon";
import storageRouter from "./storage";
import userProfileRouter from "./user_profile";
import userPreferencesRouter from "./user_preferences";
import userSecurityRouter from "./user_security";

const systemRouter = Router();

systemRouter.use("/auth", authRouter);
systemRouter.use("/users", userRouter);
systemRouter.use("/users/me/profile", userProfileRouter);
systemRouter.use("/users/me/preferences", userPreferencesRouter);
systemRouter.use("/users/me/security", userSecurityRouter);
systemRouter.use("/payments", paymentRouter);
systemRouter.use("/coupons", couponRouter);
systemRouter.use("/storage", storageRouter);
systemRouter.use("/tenants", tenantRouter);

export default systemRouter;
