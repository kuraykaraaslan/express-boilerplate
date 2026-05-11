/**
 * @deprecated This file is no longer used.
 * All routing is now handled directly in index.ts via systemRouter and tenantScopedRouter.
 * Kept as an empty module to avoid breaking any stale imports during transition.
 */
import { Router } from "express";

const apiRouter = Router();

export default apiRouter;
