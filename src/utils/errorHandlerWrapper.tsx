import { Request, Response, NextFunction } from "express";
import Logger from "../helpers/Logger";

const errorHandlerWrapper =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (error: any) {
      const NODE_ENV = process.env.NODE_ENV || "production";

      Logger.error(error.message, req, res);

      if (NODE_ENV === "development") {
        res.status(error.code || 500).json({
          error: error.message || "INTERNAL_SERVER_ERROR",
        });
      } else {
        res.status(error.code || 500).json({
          error: "INTERNAL_SERVER_ERROR",
        });
      }
    }
  };

export default errorHandlerWrapper;
