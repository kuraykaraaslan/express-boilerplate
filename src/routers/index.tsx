/*
    This file is the main router file. It will be used to combine all the routers in the application.
    The main router will be used in the index.tsx file to route the requests to the appropriate routers.
*/
import express from "express"
import Response from '../response/Response';
import Request from '../request/Request';
import V1Router from "./v1";



const mainRouter = express.Router();

mainRouter.use(express.static('public'));


mainRouter.get('/', (req, res) => {
    return res.send(
        {
            message: 'Welcome to the ExpressJS Boilerplate',
            version: '1.0.0',
            developer: 'Kuray Karaaslan',
            repo: 'github.com/kuraykaraslan/expressjs-boilerplate',
            github: 'github.com/kuraykaraslan',
            linkedin: 'linkedin.com/in/kuraykaraslan'
        }
    );
});

mainRouter.use('/api/v1', V1Router);


// return 404 if no route matched
mainRouter.use((req: Request, res: Response) => {
    return res.status(404).send({ error: 'NOT_FOUND' });
});



export default mainRouter;