/*
    This file is responsible for handling all the routes related to the authentication of the user.
    If there is a route that is related to the authentication of the user, it should be here.
*/
import express from "express";
import AuthService from "../../services/AuthService";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Response from "../../response/Response";
import Request from "../../request/Request";
import authMiddleware from "../../middlewares/authMiddleware";

const AuthRouter = express.Router();


AuthRouter.get("/", async (req: Request, res: Response) => {
  res.send({ message: "AUTH_OK" });
});

AuthRouter.post("/create-admin", async (req: Request, res: Response) => {

  await AuthService.getTheEmailFromEnvAndMakeItAdmin();

  return res.json({ message: "ADMIN_CREATED" });
});


/*
    Those routes are public and can be accessed by anyone.
*/

AuthRouter.get("/callback/:provider", async (req: Request, res: Response) => {

  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

  try {
    const { provider } = req.params;
    const { code, state, scope } = req.query;

    const callback = await AuthService.callback(
      provider,
      code as string,
      state as string,
    );

    console.log(callback);

    return res.redirect(
      `${FRONTEND_URL}/auth/sso?token=` + callback.token,
    );
  } catch (error: any) {
    console.log(error);
    return res.redirect(
      `${FRONTEND_URL}/auth/sso?error=SOMETHING_WENT_WRONG`,
    );
  }
});

AuthRouter.post(
  "/register",

  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    await AuthService.createUser(email, password);

    return res.status(201).json({ message: "USER_CREATED" });
  }),
);

AuthRouter.post(
  "/login",

  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const result = await AuthService.login(email, password, req);

    return res.json(result);
  }),
);


AuthRouter.post(
  "/verify",

  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { email, code } = req.body;

    await AuthService.verifyFirstVerificationEmail(email, code);

    return res.json({ message: "USER_VERIFIED" });
  }),
);

AuthRouter.post(
  "/resend-verification",

  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { email } = req.body;

    await AuthService.sendFirstVerificationEmailByEmail(email);

    return res.json({ message: "VERIFICATION_EMAIL_RESENT" });
  }),
);

AuthRouter.post(
  "/forgot-password",

  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { email } = req.body;

    await AuthService.sendForgotPasswordEmail(email);

    return res.json({ message: "FORGOT_PASSWORD" });
  }),
);

AuthRouter.post(
  "/reset-password",

  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { email, code, password } = req.body;

    await AuthService.verifyForgotPasswordEmail(email, code, password);

    return res.json({ message: "PASSWORD_RESET" });
  }),
);

/* 
    Those routes are for sending OTP to the user.
*/

AuthRouter.post(
  "/otp/sms-send",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { token } = req.body;

    await AuthService.sendOTPPhone(token as string);

    return res.json({ message: "OTP_SENT" });
  }),
);

AuthRouter.post(
  "/otp/email-send",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { token } = req.body;

    await AuthService.sendOTPEmail(token as string);

    return res.json({ message: "OTP_SENT" });
  }),
);

AuthRouter.post(
  "/otp/sms-verify",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { token, code } = req.body;

    await AuthService.verifyOTPPhone(token, code);

    return res.json({ message: "OTP_VERIFIED" });
  }),
);

AuthRouter.post(
  "/otp/email-verify",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const { token, code } = req.body;

    await AuthService.verifyOTPEmail(token, code);

    return res.json({ message: "OTP_VERIFIED" });
  }),
);


/* 
    Those routes are protected by the authMiddleware.
    It uses the authMiddleware to authenticate the user.
*/

AuthRouter.use(authMiddleware("USER"));

AuthRouter.post(
  "/logout",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const token = req.headers.authorization as string;

    await AuthService.logout(token);

    return res.json({ message: "LOGGED_OUT" });
  }),
);


AuthRouter.get(
  "/me",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    return res.json(user);
  }),
);

AuthRouter.post(
  "/logout",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.revokeAllSessionsbyUserId(user.id);

    return res.json({ message: "LOGGED_OUT" });
  }),
);

AuthRouter.post(
  "/otp/enable-phone",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.enablePhoneOTP(user);

    return res.json({ message: "PHONE_OTP_ENABLED" });
  }),
);

AuthRouter.post(
  "/otp/enable-email",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.enableEmailOTP(user);

    return res.json({ message: "EMAIL_OTP_ENABLED" });
  }),
);

AuthRouter.post(
  "/otp/disable-phone",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.disablePhoneOTP(user);

    return res.json({ message: "PHONE_OTP_DISABLED" });
  }),
);

AuthRouter.post(
  "/otp/disable-email",
  authMiddleware,
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.disableEmailOTP(user);

    return res.json({ message: "EMAIL_OTP_DISABLED" });
  }),
);

AuthRouter.post(
  "/otp/disable-all",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.disableOTP(user);

    return res.json({ message: "ALL_OTP_DISABLED" });
  }),
);

AuthRouter.post(
  "/change-password",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;
    const { oldPassword, newPassword } = req.body;

    await AuthService.changePassword(user, oldPassword, newPassword);

    return res.json({ message: "PASSWORD_CHANGED" });
  }),
);

AuthRouter.post(
  "/change-email",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;
    const { email } = req.body;

    await AuthService.changeEmail(user, email);

    return res.json({ message: "EMAIL_CHANGED" });
  }),
);

AuthRouter.post(
  "/change-phone",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;
    const { phone } = req.body;

    await AuthService.changePhone(user, phone);

    return res.json({ message: "PHONE_CHANGED" });
  }),
);

AuthRouter.get(
  "/sessions",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    const sessions = await AuthService.listAllSessionsByUser(user);

    const confidantelizedSessions = sessions.map((session) => {
      return {
        sessionId: session.sessionId,
        os: session.os,
        browser: session.browser,
        device: session.device,
        ip: session.ip,
        region: session.region,
        city: session.city,
        country: session.country,
        isp: session.isp
      };
    }
    );

    return res.json(confidantelizedSessions);
  }),
);

AuthRouter.delete(
  "/sessions",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    await AuthService.revokeAllSessionsbyUserId(user);

    return res.json({ message: "ALL_SESSIONS_REVOKED" });
  }),
);

AuthRouter.delete(
  "/sessions/:sessionId",
  errorHandlerWrapper(async (req: Request, res: Response) => {
    const user = req.user;

    const { sessionId } = req.params;

    const session = await AuthService.getSessionBySessionId(sessionId);

    if (session.userId !== user.userId) {
      return res.status(403).json({ message: "FORBIDDEN" });
    }

    await AuthService.revokeSessionByToken(session.token);

    return res.json({ message: "SESSION_REVOKED" });
  }),
);

export default AuthRouter;
