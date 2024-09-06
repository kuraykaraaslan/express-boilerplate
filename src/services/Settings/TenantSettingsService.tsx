import prisma , { TenantSetting } from "@/libs/prisma";
import defaultSettings from "../../config/tenant.json";
import { Tenant } from "@prisma/client";

export default class TenantSettingService {

    static defaultKeys = Object.keys(defaultSettings) as string[];
    static defaultValues = Object.values(defaultSettings) as string[];

    static validateKey(key: string): void {
        const regex = /^[a-zA-Z0-9_\-]+$/;
        if (key.match(regex)) {
            throw new Error("INVALID_KEY");
        }
        return;
    }


    static validateValue(value: string): void {
        const regex = /^[a-zA-Z0-9_\-]+$/;
        if (value.match(regex)) {
            throw new Error("INVALID_VALUE");
        }
        return;
    }

    static getDefaultValue(key: string): string {

        if (!key) {
            throw new Error("INVALID_KEY");
        }

        this.validateKey(key);

        const index = this.defaultKeys.indexOf(key);
        return this.defaultValues[index];
    }

    static async initDefaultSettings(tenant: Tenant) {
        for (let i = 0; i < this.defaultKeys.length; i++) {
            const key = this.defaultKeys[i];
            const existingSetting = await this.getSetting(tenant, key);
            
            if (!existingSetting) {
                await this.createSetting(tenant, key, this.defaultValues[i]);
            }
        }
    }

    static async getSetting(tenant: Tenant, key: string): Promise<TenantSetting | null> {

        if (!tenant) {
            throw new Error("INVALID_TENANT");
        }

        if (!key) {
            throw new Error("INVALID_KEY");
        }

        this.validateKey(key);

        const fromDatabase  = await prisma.tenantSetting.findFirst({
            where: {
                tenantId: tenant.tenantId,
                key
            }
        });
    
        if (fromDatabase) {
            return {
                tenantId: fromDatabase.tenantId,
                key: fromDatabase.key,
                value: fromDatabase.value
            };
        }


        return null;
    }

    static async createSetting(tenant: Tenant, key: string, value: string): Promise<TenantSetting> {

        this.validateKey(key);
        this.validateValue(value);

        return await prisma.tenantSetting.create({
            data: {
                tenantId: tenant.tenantId,
                key,
                value
            }
        });
    }

    static async updateSetting(tenant: Tenant, key: string, value: string): Promise<TenantSetting> {

        this.validateKey(key);
        this.validateValue(value);

        return await prisma.tenantSetting.update({
            where: {
                tenantId_key: {
                    tenantId: tenant.tenantId,
                    key
                }
            },
            data: {
                value
            }
        });
    }

    static async deleteSetting(tenant: Tenant, key: string): Promise<TenantSetting> {

        this.validateKey(key);
        
        return await prisma.tenantSetting.delete({
            where: {
                tenantId_key: {
                    tenantId: tenant.tenantId,
                    key
                }
            }
        });
    }

    static async getAllSettings(tenant: Tenant): Promise<TenantSetting[]> {
        return await prisma.tenantSetting.findMany({
            where: {
                tenantId: tenant.tenantId
            }
        });
    }
}
