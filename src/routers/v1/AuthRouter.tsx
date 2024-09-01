/*
    This file is responsible for handling all the routes related to the authentication of the user.
*/
import express from "express"
import AuthService from "../../services/AuthService";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Response from '../../response/Response';
import Request from '../../request/Request';
import authMiddleware from "../../middlewares/authMiddleware";

const AuthRouter = express.Router();

/*
    Those routes are public and can be accessed by anyone.
*/

AuthRouter.post('/register',

    errorHandlerWrapper(
        async (req, res) => {

            const { email, password } = req.body;

            const result = await AuthService.createUser(email, password);

            return res.status(201).json({ message: 'USER_CREATED' });

        }
    )
);

AuthRouter.post('/login',

    errorHandlerWrapper(
    async (req, res) => {

        const { email, password } = req.body;

        const result = await AuthService.login(email, password);

        return res.json(result);
    }
    )
);

AuthRouter.post('/verify',

    errorHandlerWrapper(
    async (req, res) => {

        const { email, code } = req.body;

        const result = await AuthService.verifyFirstVerificationEmail(email, code);

        return res.json({ message: 'USER_VERIFIED' });
    }
    )
);

AuthRouter.post('/resend-verification',
    
        errorHandlerWrapper(
        async (req, res) => {
    
            const { email } = req.body;
    
            const result = await AuthService.sendFirstVerificationEmailByEmail(email);
    
            return res.json({ message: 'VERIFICATION_EMAIL_RESENT' });
        }
        )
    );
    

AuthRouter.post('/forgot-password',
    
        errorHandlerWrapper(
        async (req, res) => {
    
            const { email } = req.body;
    
            const result = await AuthService.sendForgotPasswordEmail(email);
    
            return res.json({ message: 'FORGOT_PASSWORD' });
        }
        )
    );

AuthRouter.post('/reset-password',
    
        errorHandlerWrapper(
        async (req, res) => {
    
            const { email, code, password } = req.body;
    
            const result = await AuthService.verifyForgotPasswordEmail(email, code, password);
    
            return res.json({ message: 'PASSWORD_RESET' });
        }
        )
    );


/* 
    Those routes are for sending OTP to the user.
*/

AuthRouter.post('/otp/sms-send',
    errorHandlerWrapper(
        async (req, res) => {

            const { authorization } = req.body;

            const result = await AuthService.sendOTPPhone(authorization as string);

            return res.json({ message: 'OTP_SENT' });
        }
    )
);

AuthRouter.post('/otp/email-send',
    errorHandlerWrapper(
        async (req, res) => {

            const { authorization } = req.body;

            const result = await AuthService.sendOTPEmail(authorization as string);

            return res.json({ message: 'OTP_SENT' });
        }
    )
);

AuthRouter.post('/otp/sms-verify',
    errorHandlerWrapper(
        async (req, res) => {

            const { authorization, code } = req.body;

            const result = await AuthService.verifyOTPPhone(authorization, code);

            return res.json({ message: 'OTP_VERIFIED' });
        }
    )
);

AuthRouter.post('/otp/email-verify',
    errorHandlerWrapper(
        async (req, res) => {

            const { authorization, code } = req.body;

            const result = await AuthService.verifyOTPEmail(authorization, code);

            return res.json({ message: 'OTP_VERIFIED' });
        }
    )
);


/* 
    Those routes are protected by the authMiddleware.
    It uses the authMiddleware to authenticate the user.
*/

AuthRouter.get('/me',
    authMiddleware,
    errorHandlerWrapper(
        async (req: Request, res: Response) => {

            const user = req.user;

            return res.json(user);
        }
    )
);

AuthRouter.post('/logout',
    authMiddleware,
    errorHandlerWrapper(
        async (req: Request, res: Response) => {

            const user = req.user;

            const result = await AuthService.revokeAllSessionsbyUserId(user.id);

            return res.json({ message: 'LOGGED_OUT' });
        }
    )
);



export default AuthRouter;