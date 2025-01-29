import prisma from "../libs/prisma";
import { SystemSettings } from "@prisma/client";


async function main() {
    console.log("Seeding default settings...");

    // ✅ Default System Settings
    const defaultSystemSettings = [
        {
            key: "APPLICATION_NAME",
            value: "Express Boilerplate"
        },
        {
            key: "APPLICATION_DESCRIPTION",
            value: "Express Boilerplate is a starter project for building Node.js applications with Express.js."
        },
        {
            key: "APPLICATION_VERSION",
            value: "1.0.0"
        },
        {
            key: "APPLICATION_URL",
            value: "http://localhost:3000"
        }
    ] as SystemSettings[];

    for (const setting of defaultSystemSettings) {
        await prisma.systemSettings.upsert({
            where: { key: setting.key },
            update: setting,
            create: setting,
        });
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });