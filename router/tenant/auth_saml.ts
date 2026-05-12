import { Router, Request, Response } from "express";
import SamlService from "@/modules/auth_saml/auth_saml.service";

const router = Router();

router.get("/authorize/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement SAML authorization
    res.json({ tenantId });
  } catch (e) { next(e); }
});

router.post("/callback/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement SAML callback
    res.json({ tenantId });
  } catch (e) { next(e); }
});

router.get("/metadata/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement SAML metadata
    res.json({ tenantId });
  } catch (e) { next(e); }
});

router.get("/config/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: get SAML config
    res.json({ tenantId });
  } catch (e) { next(e); }
});

router.put("/config/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: upsert SAML config
    res.json({ tenantId });
  } catch (e) { next(e); }
});

router.delete("/config/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: delete SAML config
    res.json({ tenantId });
  } catch (e) { next(e); }
});

export default router;
