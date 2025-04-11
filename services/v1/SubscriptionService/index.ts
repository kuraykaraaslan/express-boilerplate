import { Subscription, User } from '@prisma/client';
import prisma from '@/libs/prisma';

/**
 * Service class responsible for managing orders and handling payment-specific logic.
 */
export default class SubscriptionService {


    static async listSubscriptions({ skip, take, search }: { skip: number, take: number, search: string }) {
        const result = await Promise.all([
            prisma.subscription.findMany({
            where: {
                OR: [
                    {
                        subscriptionId: {
                            contains: search,
                        },
                    },
                    {
                        tenant: {
                            name: {
                                contains: search,
                            },
                        },
                    },
                ],
            },
            skip: skip,
            take: take,
            include: {
                tenant: true,
                subscriptionPrice: true,
            },
        }),

        prisma.subscription.count({
            where: {
                OR: [
                    {
                        subscriptionId: {
                            contains: search,
                        },
                    },
                    {
                        tenant: {
                            name: {
                                contains: search,
                            },
                        },
                    },
                ],
            },
        }),
        ]);

        return {
            subscriptions: result[0],
            total: result[1],
        };
    }

    static async findSubscriptionById({ subscriptionId }: { subscriptionId: string }) {
        const subscription = await prisma.subscription.findUnique({
            where: {
                subscriptionId: subscriptionId,
            },
            include: {
                tenant: true,
                subscriptionPrice: true,
            },
        });

        return subscription;
    }

    static async updateSubscription({ subscriptionId, data }: { subscriptionId: string, data: Partial<Subscription> }) {
        const subscription = await prisma.subscription.update({
            where: {
                subscriptionId: subscriptionId,
            },
            data: data,
        });

        return subscription;
    }
}
    
