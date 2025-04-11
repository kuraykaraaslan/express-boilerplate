import { Address, Subscription, SubscriptionPrice, SubscriptionPlan } from "@prisma/client";
import TenantOmit from "./TenantOmit";

interface SubscriptionExtended extends Subscription {
    tenant: TenantOmit,
    billingAddress: Address,
    subscriptionPlan: SubscriptionPlan,
    subscriptionPrice: SubscriptionPrice,
}

export type { SubscriptionExtended };


