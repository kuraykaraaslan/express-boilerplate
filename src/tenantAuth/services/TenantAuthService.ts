import redis from "../../shared/libs/redis";
import prisma from "../../shared/libs/prisma";
import TenantService from "../../tenant/services";
import SafeTenantUser from "../../../types/SafeTenantUser";
import UserSessionService from "../../auth/services/UserSessionService";
import SafeUserSession from "@/types/SafeUserSession";

export default class TenantUserSessionService {

    static readonly SafeTenantSelect = TenantService.SafeTenantSelect;
    static readonly TENANT_USER_NOT_FOUND = "TENANT_USER_NOT_FOUND";
    static readonly INVALID_TENANT_USER_REQUEST = "INVALID_TENANT_USER_REQUEST";
    static readonly INVALID_TENANT_USER_SESSION_REQUEST = "INVALID_TENANT_USER_SESSION_REQUEST";

    static getRedisKeyForSession(userSessionId: string): string {
        return `session:tenant:${userSessionId}`;
    }

    /**
     * Stores full SafeTenantUser in Redis based on session accessToken
     */
    static async setUserSessionTenantUser(data: { tenantUser: SafeTenantUser, userSession: SafeUserSession }): Promise<boolean> {
        const { tenantUser, userSession } = data;

        console.log("Setting user session in Redis:", { tenantUser, userSession });

        if (!tenantUser || !userSession) {
            console.warn("Invalid tenant user or access token.");
            throw new Error(this.INVALID_TENANT_USER_SESSION_REQUEST);
        }

        if (!userSession || tenantUser.userId !== userSession.userId) {
            console.warn("User session not found or userId mismatch.");
            throw new Error(this.INVALID_TENANT_USER_SESSION_REQUEST);
        }

        const key = this.getRedisKeyForSession(userSession.userSessionId);
        const existingData = await redis.get(key);

        if (existingData) {
            try {
                const existingTenantUser = JSON.parse(existingData) as SafeTenantUser;

                // Aynı kullanıcı, farklı tenant'a geçiyorsa izin ver
                if (existingTenantUser.userId !== tenantUser.userId) {
                    throw new Error("Session is already bound to a different user.");
                }

                // Eğer aynı kullanıcı farklı tenant ile devam ediyorsa, güncelle
            } catch (err) {
                console.warn("Redis parse failed. Overwriting with new data.");
                // corrupted data varsa direkt üstüne yaz
            }
        }

        const payload = JSON.stringify(tenantUser);
        await redis.set(key, payload, "EX", 60 * 60 * 1); // 1 hour expiration

        return true;
    }

    /**
     * Gets full SafeTenantUser object from Redis by accessToken
     */
    static async getSafeTenantUserFromSession(userSession: SafeUserSession): Promise<SafeTenantUser | null> {
        const key = this.getRedisKeyForSession(userSession.userSessionId);
        const data = await redis.get(key);

        if (!data) return null;

        try {
            return JSON.parse(data) as SafeTenantUser;
        } catch {
            return null;
        }
    }

    /**
     * Deletes the tenant user session from Redis
     */
    static async deleteTenantUserSession(accessToken: string): Promise<void> {
        const key = this.getRedisKeyForSession(accessToken);
        await redis.del(key);
    }
}
