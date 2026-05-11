import { Router, Request, Response } from "express";
import AuthSSOService from "../auth_sso.service";

const router = Router();

// GET /callback/:provider
router.get("/callback/:provider", async (req: Request, res: Response, next) => {
  try {
    const { provider } = req.params;
    const { code, state } = req.query;
    // TODO: implement SSO callback
    res.json({ provider, code, state });
  } catch (e) { next(e); }
});

// GET /authorize/:provider
router.get("/authorize/:provider", async (req: Request, res: Response, next) => {
  try {
    const { provider } = req.params;
    // TODO: implement SSO authorization
    res.json({ provider });
  } catch (e) { next(e); }
});

export default router;
