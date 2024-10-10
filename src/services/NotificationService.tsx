import prisma, { User, Notification } from "../libs/prisma";

import Logger from "../helpers/Logger";



export default class NotificationService {

    static async getUserNotifications(userId: string, page: number, pageSize: number): Promise<Notification[]> {
        const notifications = await prisma.notification.findMany({
            where: {
                userId
            },
            skip: page * pageSize,
            take: pageSize
        });

        return notifications;
    }

    static async createLoginNotification(user: User): Promise<void> {
        await prisma.notification.create({
            data: {
                userId: user.userId,
                title: "Login Notification",
                message: `New login from ${user.lastLoginIP}`,
                type: "INFO"
            }
        });
    }

}
