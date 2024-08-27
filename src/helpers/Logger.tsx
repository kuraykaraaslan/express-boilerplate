import { Incident } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import Response from '../response/Response';
import Request from '../request/Request';

const prisma = new PrismaClient();

class Logger {

    static async info(message: string, req?: Request, res?: Response) {
        console.log("\x1b[34m", "[INFO]", message);
        return;

    }

    static async error(message: string, req?: Request, res?: Response) {
        //red color
        console.log("\x1b[31m", "[ERROR]", message);

        const requestId = req?.requestId || "Unknown";
        const userId = req?.user?.userId || "Unknown";
        const path = req?.originalUrl || "Unknown";


        await prisma.incident.create({
            data: {
                status: "ERROR",
                requestId: requestId,
                userId: userId,
                message: message,
                path: path
            }
        });
        
    }

    static async operation(message: string, req?: Request, res?: Response) {
        //green color
        console.log("\x1b[32m", "[OPERATION]", message);

        return;
    }

    static async success(message: string, req?: Request, res?: Response) {
        //green color
        console.log("\x1b[32m", "[SUCCESS]", message);

        return;

    }

    static async warning(message: string, req?: Request, res?: Response) {
        //yellow color
        console.log("\x1b[33m", "[WARNING]", message);

        return;
    }

    static async connect(req: any, res: any) {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const path = req.originalUrl;
        const method = req.method;
        const userAgent = req.headers['user-agent'] || "Unknown";

        //blue color
        console.log("\x1b[34m", "[CONNECT]", ip, path, method, userAgent);

        return;
    }
}


export default Logger;