/*
  This middleware will catch any error that is thrown in the application and return a 500 status code with an error message.
*/
import express , { NextFunction } from 'express';
import Response from '../response/Response';
import Request from '../request/Request';

export default function errorMiddleware(error: Error, req: Request, res: Response, next: NextFunction) {

    const env = process.env.NODE_ENV || 'development';
    /* 
      If the environment is development, then return the error message in the response.
      If the environment is production, then return a generic error message.
    */
   
    if (env === 'development') {
        res.status(500).json({ error: error.message });
    } else {
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
    
}
  
