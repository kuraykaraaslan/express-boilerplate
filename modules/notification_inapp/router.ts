import { Router, Request, Response } from "express";
const router = Router();
router.get("/", async (req: Request, res: Response, next) => {
  try { res.json({ notifications: [] }); } catch (e) { next(e); }
});
export default router;
