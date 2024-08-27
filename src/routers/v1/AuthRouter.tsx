/*
    This file is responsible for handling all the routes related to the authentication of the user.
*/
import express from "express"
import AuthService from "../../services/AuthService";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Response from '../../response/Response';
import Request from '../../request/Request';

const AuthRouter = express.Router();

AuthRouter.post('/register',

    errorHandlerWrapper(
        async (req, res) => {

            const { email, password } = req.body;

            const result = await AuthService.createUser(email, password);

            return res.status(201).json(result);

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


export default AuthRouter;