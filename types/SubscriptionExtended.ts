import { Address, Subscription, SubscriptionPrice, SubscriptionPlan } from "@prisma/client";
import SafeTenant from "./SafeTenant";

interface SubscriptionExtended extends Subscription {
    tenant: SafeTenant,
    billingAddress: Address,
    subscriptionPlan: SubscriptionPlan,
    subscriptionPrice: SubscriptionPrice,
}

export type { SubscriptionExtended };


