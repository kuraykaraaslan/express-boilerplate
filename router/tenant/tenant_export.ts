import { Router, Request, Response } from "express";

const router = Router();

router.post("/", async (req: Request, res: Response, next) => {
  try { res.json({ message: "Export started" }); } catch (e) { next(e); }
});

export default router;
