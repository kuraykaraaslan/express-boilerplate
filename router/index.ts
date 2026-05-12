import { Request, Response, NextFunction, Router } from "express";
import dotenv from "dotenv";
dotenv.config();

import SettingService from "@/modules/setting/setting.service";
import TenantDomainService from "@/modules/tenant_domain/tenant_domain.service";
import systemRouter from "@/router/system";
import tenantScopedRouter from "@/router/tenant";


const isDev = process.env.NODE_ENV !== "production";
const DEFAULT_SUBDOMAIN = process.env.TENANT_DEFAULT_SUBDOMAIN || "express-boilerplate";
const WILDCARD_DOMAIN = process.env.TENANT_WILDCARD_DOMAIN || "kuray.dev";
const TENANCY_MODE = (process.env.TENANCY_MODE || "domain") as "domain" | "path";
const TENANT_PATH_PREFIX = process.env.TENANT_PATH_PREFIX || "t";

function log(...args: unknown[]) {
    if (isDev) console.log("[PROXY]", ...args);
}

function isLocalhost(host: string): boolean {
    return (
        host === "localhost" ||
        host.startsWith("localhost:") ||
        host === "127.0.0.1" ||
        host.startsWith("127.0.0.1:")
    );
}

async function checkMaintenance(req: Request, res: Response, pathname: string): Promise<boolean> {
    if (pathname === "/maintenance") return false;
    try {
        const setting = await SettingService.getByKey("maintenanceMode");
        if (setting?.value === "true") {
            log("maintenance mode active → 503");
            res.status(503).json({ message: "Service temporarily unavailable." });
            return true;
        }
    } catch {
        log("Maintenance check failed");
    }
    return false;
}

async function handleDomainMode(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const host = req.hostname;
    const pathname = req.path;

    let tenantId: string | null = null;
    let isSystemDomain = false;

    log(`[domain] Incoming request for host: ${host}, path: ${pathname}`);

    if (isLocalhost(host) || host === `${DEFAULT_SUBDOMAIN}.${WILDCARD_DOMAIN}`) {
        isSystemDomain = true;
        log("[domain] Detected system domain (localhost or default subdomain)");
    } else {
        try {
            const domainInfo = await TenantDomainService.getByDomain(host);
            if (domainInfo) tenantId = domainInfo.tenantId;
        } catch {
            log("Tenant lookup failed");
        }
    }

    if (tenantId) {
        req.url = `/tenant/${tenantId}/api${pathname}`;
        log(`[domain] Rewriting to tenant: ${tenantId}`);
        return next();
    }

    if (isSystemDomain) {
        req.url = `/system/api${pathname}`;
        log("[domain] Rewriting to system");
        return next();
    }

    next();
}

function handlePathMode(req: Request, _res: Response, next: NextFunction): void {
    const pathname = req.path;
    const tenantPrefix = `/${TENANT_PATH_PREFIX}/`;

    if (pathname.startsWith(tenantPrefix)) {
        const withoutPrefix = pathname.slice(tenantPrefix.length);
        const slashIndex = withoutPrefix.indexOf("/");
        const tenantId = slashIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIndex);
        const rest = slashIndex === -1 ? "" : withoutPrefix.slice(slashIndex);

        if (!tenantId) {
            req.url = `/system/api${pathname}`;
            log("[path] No tenantId → rewriting to system");
            return next();
        }

        req.url = `/tenant/${tenantId}/api${rest || "/"}`;
        log(`[path] Rewriting to tenant: ${tenantId}`);
        return next();
    }

    req.url = `/system/api${pathname}`;
    log("[path] Rewriting to system");
    next();
}

const router = Router();

// ✅ /api/system/{rest}            → /system/api/{rest}
// ✅ /api/tenant/{tenantId}/{rest} → /tenant/{tenantId}/api/{rest}
router.use((req, _res, next) => {
    if (req.path.startsWith("/api/system/") || req.path === "/api/system") {
        req.url = `/system/api${req.path.slice("/api/system".length) || "/"}`;
        log(`[api] system → ${req.url}`);
    } else if (req.path.startsWith("/api/tenant/")) {
        const withoutPrefix = req.path.slice("/api/tenant/".length);
        const slashIndex = withoutPrefix.indexOf("/");
        const tenantId = slashIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIndex);
        const rest = slashIndex === -1 ? "/" : withoutPrefix.slice(slashIndex);
        req.url = `/tenant/${tenantId}/api${rest}`;
        log(`[api] tenant(${tenantId}) → ${req.url}`);
    }
    next();
});

// Maintenance check + tenancy routing for paths not yet resolved
router.use(async (req, res, next) => {
    if (req.path.startsWith("/tenant/") || req.path.startsWith("/system/")) {
        return next();
    }

    const inMaintenance = await checkMaintenance(req, res, req.path);
    if (inMaintenance) return;

    if (TENANCY_MODE === "path") {
        return handlePathMode(req, res, next);
    }
    return handleDomainMode(req, res, next);
});

// Internal route mounts
router.use("/system", systemRouter);
router.use("/tenant/:tenantId", tenantScopedRouter);

export default router;
