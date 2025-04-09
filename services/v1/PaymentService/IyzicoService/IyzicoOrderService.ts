import IyzicoService from "@/services/v1/PaymentService/IyzicoService";
import
export default class IyzicoOrderService {

        private static axiosInstance = IyzicoService.getAxiosInstance();

        //TODO: create a class for order handle
    /**
     * Initializes a payment intent using Iyzico Checkout Form API.
     */
    static async createPaymentIntent(order: Order): Promise<any> {

        const path = '/payment/pay-with-iyzico/initialize';

        const requestBody = {
            "locale": "tr",
            "conversationId": order.id,
            "price": order.price,
            "basketId": order.tenantProfileId + "+"  + order.tenantId,
            "paymentGroup": "SUBSCRIPTION",
            "callbackUrl": `${process.env.NEXT_PUBLIC_BASE_URL}/api/gateway/${order.id}/pay/callback/iyzico`,
            "notificationUrl": "https://test.requestcatcher.com/test",
            "currency": "TRY",
            "paidPrice": order.price,
            "enabledInstallments": [
                1,
                2,
                3,
                6,
                9,
                12
            ],
            "buyer": {
                "id": "buyerID",
                "name": "buyerName",
                "surname": "buyerSurname",
                "identityNumber": "11111111111",
                "email": "email@email.com",
                "gsmNumber": "+905350000000",
                "registrationAddress": "Burhaniye Mahallesi Atilla Sokak No:7 Üsküdar",
                "city": "Istanbul",
                "country": "Turkey",
                "ip": "85.34.78.112"
            },
            "shippingAddress": {
                "address": "Burhaniye Mahallesi Atilla Sokak No:7 Üsküdar",
                "contactName": "Contact Name",
                "city": "Istanbul",
                "country": "Turkey"
            },
            "billingAddress": {
                "address": "Burhaniye Mahallesi Atilla Sokak No:7 Üsküdar",
                "contactName": "Contact Name",
                "city": "Istanbul",
                "country": "Turkey"
            },
            "basketItems": [
                {
                    "id": order.tenantProfileId,
                    "price": order.price,
                    "name": "product Name",
                    "category1": "Category Name",
                    "itemType": "PHYSICAL"
                }
            ]
        };

        // Generate the PKI string
        const uri_path = path;
        const payload = JSON.stringify(requestBody);
        const { authorization, "x-iyzi-rnd": x_iyzi_rnd } = this.generateAuthorizationString(payload, uri_path);
        const headers = {
            'authorization': authorization,
            'content-type': 'application/json',
            'x-iyzi-rnd': x_iyzi_rnd,
        }

        console.log('Iyzico request headers:', headers);
        // Send the request to Iyzico API
        const response = await axios.post(`${this.IYZICO_BASE_URL}${path}`, requestBody,
            {
                headers: headers,
            });
        // Check if the response is successful  

        // save token to the order
        await prisma.tenantSubscription.update({
            where: {
                id: order.id,
            },
            data: {
                iyzicoToken: response.data.token,
            }
        });

        //console.log('Iyzico response:', response);
        return response.data;
    }

    static async getPaymentStatus(token: string): Promise<any> {
        const path = '/payment/iyzipos/checkoutform/auth/ecom/detail';

        const requestBody = {
            "locale": "tr",
            "conversationId": "123456789",
            "token": token
        };

        // Generate the PKI string
        const uri_path = path;
        const payload = JSON.stringify(requestBody);
        const { authorization, "x-iyzi-rnd": x_iyzi_rnd } = this.generateAuthorizationString(payload, uri_path);
        const headers = {
            'authorization': authorization,
            'content-type': 'application/json',
            'x-iyzi-rnd': x_iyzi_rnd,
        }

        console.log('Iyzico request headers:', headers);
        // Send the request to Iyzico API
        const response = await axios.post(`${this.IYZICO_BASE_URL}${path}`, requestBody,
            {
                headers: headers,
            });
        // Check if the response is successful  

        //console.log('Iyzico response:', response);
        return response.data.status;
    }
}
