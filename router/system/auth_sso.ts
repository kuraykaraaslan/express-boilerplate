import { Router, Request, Response } from "express";
import AuthSSOService from "@/modules/auth_sso/auth_sso.service";

const router = Router();

router.get("/callback/:provider", async (req: Request, res: Response, next) => {
  try {
    const { provider } = req.params;
    const { code, state } = req.query;
    // TODO: implement SSO callback
    res.json({ provider, code, state });
  } catch (e) { next(e); }
});

router.get("/authorize/:provider", async (req: Request, res: Response, next) => {
  try {
    const { provider } = req.params;
    // TODO: implement SSO authorization
    res.json({ provider });
  } catch (e) { next(e); }
});

export default router;
