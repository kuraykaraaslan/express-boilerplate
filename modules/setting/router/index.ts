import { Router, Request, Response } from "express";
import SettingService from "../setting.service";
import { AppError } from "@/libs/app-error";

const router = Router();

// GET /
router.get("/", async (req: Request, res: Response, next) => {
  try {
    const settings = await SettingService.getAllAsRecord();
    res.json({ success: true, settings });
  } catch (e) { next(e); }
});

// GET /:key
router.get("/:key", async (req: Request, res: Response, next) => {
  try {
    const setting = await SettingService.getByKey(req.params.key);
    if (!setting) throw new AppError("Setting not found", 404);
    res.json({ success: true, setting });
  } catch (e) { next(e); }
});

// PUT /:key
router.put("/:key", async (req: Request, res: Response, next) => {
  try {
    const { value } = req.body;
    const setting = await SettingService.update(req.params.key, value);
    res.json({ success: true, setting });
  } catch (e) { next(e); }
});

// PATCH /bulk
router.patch("/bulk", async (req: Request, res: Response, next) => {
  try {
    const { settings } = req.body;
    const updated = await SettingService.updateMany(settings);
    res.json({ success: true, settings: updated });
  } catch (e) { next(e); }
});

// DELETE /:key
router.delete("/:key", async (req: Request, res: Response, next) => {
  try {
    const setting = await SettingService.delete(req.params.key);
    if (!setting) throw new AppError("Setting not found", 404);
    res.json({ success: true, setting });
  } catch (e) { next(e); }
});

export default router;
