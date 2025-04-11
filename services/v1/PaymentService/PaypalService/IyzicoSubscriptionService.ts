import IyzicoService from "@/services/v1/PaymentService/IyzicoService";
import { SubscriptionExtended } from "@/types/SubscriptionExtended";
import { UserAgentData } from "@/types/UserAgentData";
import { SubscriptionPrice, User } from "@prisma/client";
export default class IyzicoSubscriptionService {

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
                return response.data;
        }
        

}
