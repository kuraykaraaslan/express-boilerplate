import { Router, Request, Response } from "express";
import ImpersonationService from "@/modules/auth_impersonation/impersonation.service";

const router = Router();

router.post("/system", async (req: Request, res: Response, next) => {
  try {
    // TODO: implement system impersonation
    res.json({ message: "system impersonation" });
  } catch (e) { next(e); }
});

router.post("/tenant/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement tenant impersonation
    res.json({ tenantId });
  } catch (e) { next(e); }
});

router.delete("/end", async (req: Request, res: Response, next) => {
  try {
    // TODO: implement end impersonation
    res.json({ message: "impersonation ended" });
  } catch (e) { next(e); }
});

export default router;
