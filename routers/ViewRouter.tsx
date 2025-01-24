import { Request, Response, Router } from 'express';
import EmptyRequest from '../dtos/requests/EmptyRequest';
import FieldValidater from '../utils/FieldValidater';
import ejs from 'ejs';
import path from 'path';


const TEMPLATE_PATH = path.join(__dirname, '../views/');


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

    return await ejs.renderFile(path.join(TEMPLATE_PATH, 'auth/sso.ejs'), { message: ''});
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