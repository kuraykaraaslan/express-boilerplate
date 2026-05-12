import { Router, Request, Response } from "express";

const router = Router();

router.get("/", async (req: Request, res: Response, next) => {
  try {
    // TODO: list social accounts
    res.json({ accounts: [] });
  } catch (e) { next(e); }
});

export default router;
