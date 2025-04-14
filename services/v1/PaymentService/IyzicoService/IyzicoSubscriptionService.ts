import IyzicoService from "../IyzicoService"
import { SubscriptionExtended } from "@/types/SubscriptionExtended";
import { Subscription, SubscriptionPrice, SubscriptionStatus, User } from "@prisma/client";
import SubscriptionService from "../../SubscriptionService";
export default class IyzicoSubscriptionService {

    static readonly TOKEN_NOT_FOUND = "TOKEN_NOT_FOUND";
    static readonly SUBSCRIPTION_NOT_FOUND = "SUBSCRIPTION_NOT_FOUND";
    static readonly SUBSCRIPTION_CANCELLED = "SUBSCRIPTION_CANCELLED";
    static readonly SUBSCRIPTION_CANCEL_FAILED = "SUBSCRIPTION_CANCEL_FAILED";
    static readonly SUBSCRIPTION_PAYMENT_FAILED = "SUBSCRIPTION_PAYMENT_FAILED";

    private static axiosInstance = IyzicoService.getAxiosInstance();

    static async createPaymentIntent({ subscription, user }: { subscription: SubscriptionExtended, user: User }): Promise<any> {
        const path = '/v2/subscription/checkoutform/initialize';

        const requestBody = {
            "callbackUrl": `${process.env.NEXT_PUBLIC_BASE_URL}/api/gateway/${subscription.subscriptionId}/pay/callback/iyzico`,
            "pricingPlanReferenceCode": subscription.subscriptionPriceId,
            "subscriptionInitialStatus": "ACTIVE",
            "conversationId": subscription.subscriptionId,
            "customer": {
                "name": user.name,
                "surname": user.lastName,
                "email": user.email,
                "gsmNumber": user.phone,
                "identityNumber": user.userNationalityId ? user.userNationalityId : "111111111111",
                "billingAddress": {
                    "address": `${subscription.billingAddress.addressLine1} ${subscription.billingAddress.addressLine2}`,
                    "zipCode": `${subscription.billingAddress.zipCode}`,
                    "contactName": `${subscription.billingAddress.firstName} ${subscription.billingAddress.lastName}`,
                    "city": `${subscription.billingAddress.city}`,
                    "country": `${subscription.billingAddress.country}`,
                }
            }
        }

        const response = await this.axiosInstance.post(path, requestBody);

        //save token
        const iyzicoToken = response.data.token;

        if (!iyzicoToken) {
            throw new Error(IyzicoSubscriptionService.TOKEN_NOT_FOUND);
        }

        //save token to subscription

        await SubscriptionService.updateSubscription({
            subscriptionId: subscription.subscriptionId,
            data: {
                iyzicoToken: iyzicoToken
            }
        });

        return response.data;
    }


    static async getPaymentStatus(subscription: Subscription): Promise<any> {
        const path = '/payment/iyzipos/checkoutform/auth/ecom/detail';

        const requestBody = {
            locale: "tr",
            conversationId: "123456789",
            token: subscription.iyzicoToken
        };

        const response = await this.axiosInstance.post(path, requestBody);
        return response.data;
    }


    static async cancelSubscription({ subscription }: { subscription: SubscriptionExtended }): Promise<any> {
        ///v2/subscription/subscriptions/e5dd9172-5b59-4be1-a03a-c2ef94269e0f/cancel?locale=tr NO BODY

        const path = `/v2/subscription/subscriptions/${subscription.iyzicoToken}/cancel`;

        const response = await this.axiosInstance.post(path)

        if (response.data.status !== "success") {
            throw new Error(IyzicoSubscriptionService.SUBSCRIPTION_CANCEL_FAILED);
        }

        //update subscription status
        await SubscriptionService.updateSubscription({
            subscriptionId: subscription.subscriptionId,
            data: {
                subscriptionStatus: "CANCELLED",
            }
        });

        return response.data;

    }

    static async upgradeSubscription({ subscription, subscriptionPrice }: { subscription: SubscriptionExtended, subscriptionPrice: SubscriptionPrice }): Promise<any> {
        const path = `/v2/subscription/subscriptions/${subscription.iyzicoToken}/upgrade`;

        /*7{
            "newPricingPlanReferenceCode": "8d0c2072-4182-4ed9-86f4-ee00d6ac6150",
            "upgradePeriod": "NEXT_PERIOD",
            "useTrial": false,
            "resetRecurrenceCount": true
        }
        */

        const requestBody = {
            "newPricingPlanReferenceCode": subscriptionPrice.iyzicoPricingPlanRefId,
            "upgradePeriod": "NEXT_PERIOD",
            "useTrial": false,
            "resetRecurrenceCount": true
        }

        const response = await this.axiosInstance.post(path, requestBody);
        if (response.data.status !== "success") {
            throw new Error(IyzicoSubscriptionService.SUBSCRIPTION_CANCEL_FAILED);
        }

        //update subscription status
        await SubscriptionService.updateSubscription({
            subscriptionId: subscription.subscriptionId,
            data: {
                subscriptionStatus: SubscriptionStatus.COMPLETED,
                subscriptionPlanId: subscriptionPrice.subscriptionPlanId,
            }
        });

        return;
    }

    static async retrySubscription({ subscription }: { subscription: SubscriptionExtended }): Promise<any> {
        const path = `/v2/subscription/operation/retry`;

        /*
        {
            "referenceCode": "a2077643-bab7-4b73-85a5-7676c78d7c66"
        }
        */

        const requestBody = {
            "referenceCode": subscription.iyzicoToken
        }
        const response = await this.axiosInstance.post(path, requestBody);
        if (response.data.status !== "success") {
            throw new Error(IyzicoSubscriptionService.SUBSCRIPTION_PAYMENT_FAILED);
        }

        //update subscription status
        await SubscriptionService.updateSubscription({
            subscriptionId: subscription.subscriptionId,
            data: {
                subscriptionStatus: SubscriptionStatus.COMPLETED,
            }
        });
        
        return response.data;
    }

}

