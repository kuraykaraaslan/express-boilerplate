import {SubscriptionPlan, SubscriptionPrice} from "@prisma/client";

interface SubscriptionPlanWithPrices extends SubscriptionPlan {
    subscriptionPrices: SubscriptionPrice[]
}
export type { SubscriptionPlanWithPrices };