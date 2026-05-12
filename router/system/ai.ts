import { Router, Request, Response } from "express";
import AiService from "@/modules/ai/ai.service";

const router = Router();

router.post("/chat", async (req: Request, res: Response, next) => {
  try {
    // TODO: implement chat endpoint
    res.json({ message: "AI chat endpoint" });
  } catch (e) { next(e); }
});

export default router;
