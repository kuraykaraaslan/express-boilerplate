import { Router, Request, Response } from "express";
import SamlService from "../auth_saml.service";

const router = Router();

// GET /authorize/:tenantId - Generate SAML auth URL
router.get("/authorize/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement SAML authorization
    res.json({ tenantId });
  } catch (e) { next(e); }
});

// POST /callback/:tenantId - Handle SAML callback
router.post("/callback/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement SAML callback
    res.json({ tenantId });
  } catch (e) { next(e); }
});

// GET /metadata/:tenantId - Get SP metadata
router.get("/metadata/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: implement SAML metadata
    res.json({ tenantId });
  } catch (e) { next(e); }
});

// GET /config/:tenantId - Get SAML config
router.get("/config/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: get SAML config
    res.json({ tenantId });
  } catch (e) { next(e); }
});

// PUT /config/:tenantId - Upsert SAML config
router.put("/config/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: upsert SAML config
    res.json({ tenantId });
  } catch (e) { next(e); }
});

// DELETE /config/:tenantId - Delete SAML config
router.delete("/config/:tenantId", async (req: Request, res: Response, next) => {
  try {
    const { tenantId } = req.params;
    // TODO: delete SAML config
    res.json({ tenantId });
  } catch (e) { next(e); }
});

export default router;
