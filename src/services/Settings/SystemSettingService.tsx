import prisma , { SystemSetting } from "@/libs/prisma";
import defaultSettings from "../../config/settings.json";

export default class SystemSettingService {

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

        this.validateKey(key);

        const index = this.defaultKeys.indexOf(key);
        return this.defaultValues[index];
    }

    static async initDefaultSettings() {
        for (let i = 0; i < this.defaultKeys.length; i++) {
            const key = this.defaultKeys[i];
            const existingSetting = await this.getSetting(key);
            
            if (!existingSetting) {
                await this.createSetting(key, this.defaultValues[i]);
            }
        }
    }

    static async getSetting(key: string): Promise<SystemSetting | null> {

        this.validateKey(key);

        const fromDatabase  = await prisma.systemSetting.findFirst({
            where: {
                key
            }
        });
    
        if (fromDatabase) {
            return {
                key: fromDatabase.key,
                value: fromDatabase.value
            };
        }
    
        return null;
    }

    static async createSetting(key: string, value: string): Promise<SystemSetting> {

        this.validateKey(key);
        this.validateValue(value);

        return await prisma.systemSetting.create({
            data: {
                key,
                value
            }
        });
    }

    static async updateSetting(key: string, value: string): Promise<SystemSetting> {

        this.validateKey(key);
        this.validateValue(value);

        return await prisma.systemSetting.update({
            where: {
                key
            },
            data: {
                value
            }
        });
    }

    static async deleteSetting(key: string): Promise<SystemSetting> {

        this.validateKey(key);

        return await prisma.systemSetting.delete({
            where: {
                key
            }
        });
    }

    static async getAllSettings(): Promise<SystemSetting[]> {
        return await prisma.systemSetting.findMany();
    }
}
