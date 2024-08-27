/*
    This file is used to combine all the routers of version 1
    and export them as a single router.
*/
import express from "express"
import AuthRouter from "./AuthRouter";

const v1Router = express.Router();

v1Router.get('/', (req, res) => {
    res.send('Welcome to the version 1 router');
});

v1Router.use('/auth', AuthRouter);

export default v1Router;
