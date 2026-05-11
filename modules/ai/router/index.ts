import { Router, Request, Response } from "express";
import AiService from "../ai.service";
import { AppError } from "@/libs/app-error";

const router = Router();

// POST /chat
router.post("/chat", async (req: Request, res: Response, next) => {
  try {
    // TODO: implement chat endpoint
    res.json({ message: "AI chat endpoint" });
  } catch (e) { next(e); }
});

export default router;
