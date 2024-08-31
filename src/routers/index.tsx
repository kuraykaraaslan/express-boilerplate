/*
    This file is the main router file. It will be used to combine all the routers in the application.
    The main router will be used in the index.tsx file to route the requests to the appropriate routers.
*/
import express from "express"
import Response from '../response/Response';
import Request from '../request/Request';
import V1Router from "./v1";



const mainRouter = express.Router();


mainRouter.get('/', (req, res) => {
    res.send('Welcome to the main router');
});

mainRouter.use('/api/v1', V1Router);


// return 404 if no route matched
mainRouter.use((req: Request, res: Response) => {
    res.status(404).send({ error: 'NOT_FOUND' });
  });

  

export default mainRouter;