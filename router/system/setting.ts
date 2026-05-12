import { Router, Request, Response } from "express";
import SettingService from "@/modules/setting/setting.service";
import { AppError } from "@/modules_express/common/app-error";

const router = Router();

router.get("/", async (req: Request, res: Response, next) => {
  try {
    const settings = await SettingService.getAllAsRecord();
    res.json({ success: true, settings });
  } catch (e) { next(e); }
});

router.get("/:key", async (req: Request, res: Response, next) => {
  try {
    const setting = await SettingService.getByKey(req.params.key);
    if (!setting) throw new AppError("Setting not found", 404);
    res.json({ success: true, setting });
  } catch (e) { next(e); }
});

router.put("/:key", async (req: Request, res: Response, next) => {
  try {
    const { value } = req.body;
    const setting = await SettingService.update(req.params.key, value);
    res.json({ success: true, setting });
  } catch (e) { next(e); }
});

router.patch("/bulk", async (req: Request, res: Response, next) => {
  try {
    const { settings } = req.body;
    const updated = await SettingService.updateMany(settings);
    res.json({ success: true, settings: updated });
  } catch (e) { next(e); }
});

router.delete("/:key", async (req: Request, res: Response, next) => {
  try {
    const setting = await SettingService.delete(req.params.key);
    if (!setting) throw new AppError("Setting not found", 404);
    res.json({ success: true, setting });
  } catch (e) { next(e); }
});

export default router;
