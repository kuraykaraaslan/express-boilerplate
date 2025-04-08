import { Request, Response, Router } from 'express';

export const viewRouter = Router();

/**
 * GET /sso
 * SSO page.
 * 
 * Response:
 * - view: auth/sso
 * 
 */
viewRouter.get('/sso', async (request: Request, response: Response) => {

    return response.render('auth/sso', { message: '' });
});


/**
 * GET /login
 * Login page.
 * 
 * Response:
 * - view: auth/login
 * 
 */

viewRouter.get('/login', async (request: Request, response: Response) => {


    return response.render('auth/login', { message: '' });
});

/**
 * GET /register
 * Register page.
 * 
 * Response:
 * - view: auth/register
 * 
 */

viewRouter.get('/register', async (request: Request, response: Response) => {


    return response.render('auth/register', { message: '' });
});


export default viewRouter;