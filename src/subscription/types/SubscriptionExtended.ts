import { Address, Subscription, SubscriptionPrice, SubscriptionPlan } from "@prisma/client";
import { SafeTenant } from "./SafeTenant";

import { z } from "zod";

export const SubscriptionExtended = z.object({
    id: z.string(),
    tenantId: z.string(),
    subscriptionPlanId: z.string(),
    subscriptionPriceId: z.string(),
    billingAddressId: z.string(),
    status: z.enum(["ACTIVE", "INACTIVE", "CANCELED"]),
    createdAt: z.date(),
    updatedAt: z.date(),
    tenant: SafeTenant,
    billingAddress: Address,
    subscriptionPlan: SubscriptionPlan,
    subscriptionPrice: SubscriptionPrice,
});

export type SubscriptionExtended = z.infer<typeof SubscriptionExtended>;

