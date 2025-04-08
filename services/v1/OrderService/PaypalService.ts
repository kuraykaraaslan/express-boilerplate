import { Order, OrderStatus } from '@prisma/client';
import OrderService from '@/services/v1/OrderService';
import axios from 'axios';

/**
 * Service class for handling PayPal-related payment operations,
 * including order validation and refund processing.
 */
export default class PaypalService {
    private static PAYPAL_ACCESS_TOKEN: string | null = null;
    private static PAYPAL_ACCESS_TOKEN_EXPIRES: Date | null = null;

    private static readonly PAYPAL_API_URL = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';

    private static isOrderValid(order: Order): boolean {
        return (
            order.paymentMethod === 'PAYPAL' &&
            order.orderStatus !== OrderStatus.REFUNDED &&
            order.orderStatus !== OrderStatus.CANCELLED &&
            !!order.paypalOrderId
        );
    }

    private static mapPaypalStatusToOrderStatus(paypalStatus: string): OrderStatus | null {
        switch (paypalStatus) {
            case 'COMPLETED':
                return OrderStatus.COMPLETED;
            case 'CANCELLED':
                return OrderStatus.CANCELLED;
            case 'PAYER_ACTION_REQUIRED':
                return OrderStatus.PENDING;
            default:
                return null;
        }
    }

    private static async getAccessToken(): Promise<string> {
        if (
            this.PAYPAL_ACCESS_TOKEN &&
            this.PAYPAL_ACCESS_TOKEN_EXPIRES &&
            this.PAYPAL_ACCESS_TOKEN_EXPIRES > new Date()
        ) {
            return this.PAYPAL_ACCESS_TOKEN;
        }

        const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
        const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

        try {
            const res = await axios.post(
                `${this.PAYPAL_API_URL}/v1/oauth2/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        Authorization: `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );
            this.PAYPAL_ACCESS_TOKEN = res.data.access_token;
            this.PAYPAL_ACCESS_TOKEN_EXPIRES = new Date(Date.now() + res.data.expires_in * 1000);
            return res.data.access_token;
        } catch (error) {
            throw new Error('Failed to obtain PayPal access token');
        }
    }

    static async validateOrderStatus({
        orders,
    }: {
        orders: Order[];
    }): Promise<Order[]> {
        if (!orders.some(o => o.paymentMethod === 'PAYPAL')) {
            throw new Error('SOME_ORDERS_NOT_PAYPAL');
        }

        const token = await this.getAccessToken();

        return await Promise.all(
            orders.map(async (order) => {
                return this.validateOrderStatusById({ order, token });
            })
        );
    }

    static async validateOrderStatusById({
        order,
        token,
    }: {
        order: Order;
        token?: string;
    }): Promise<Order> {

        if (!this.isOrderValid(order)) return order;

        if (!token) {
            token = await this.getAccessToken();
        }

        try {
            const res = await axios.get(
                `${this.PAYPAL_API_URL}/v2/checkout/orders/${order.paypalOrderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const paypalStatus = res.data.status;
            const captureId = res.data?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
            const orderStatus = this.mapPaypalStatusToOrderStatus(paypalStatus);

            if (orderStatus) {
                const updateData: Partial<Order> = { orderStatus };
                if (captureId) updateData.paypalCaptureId = captureId;

                order = await OrderService.updateOrder(order, updateData);
            }

        } catch (error) {
            console.error(`PayPal validation error for order ${order.orderId}:`, error);
        }

        return order;
    }

    static async refundOrders({
        orders,
        changeStatusTo,
    }: {
        orders: Order[];
        changeStatusTo?: OrderStatus | null;
    }): Promise<Order[]> {
        if (!orders.some(o => o.paymentMethod === 'PAYPAL')) {
            throw new Error('SOME_ORDERS_NOT_PAYPAL');
        }

        const token = await this.getAccessToken();

        return await Promise.all(
            orders.map(async (order) => {
                if (!this.isOrderValid(order)) return order;
                return this.refundOrderById({ order, changeStatusTo, token });
            })
        );
    }

    static async refundOrderById({
        order,
        changeStatusTo,
        token,
    }: {
        order: Order;
        changeStatusTo?: OrderStatus | null;
        token?: string;
    }): Promise<Order> {
        if (!token) {
            token = await this.getAccessToken();
        }

        if (!order.paypalCaptureId) {
            console.warn(`Missing paypalCaptureId for order ${order.orderId}. Skipping refund.`);
            return order;
        }

        try {
            const res = await axios.post(
                `${this.PAYPAL_API_URL}/v2/payments/captures/${order.paypalCaptureId}/refund`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const paypalStatus = res.data.status;
            const orderStatus = this.mapPaypalStatusToOrderStatus(paypalStatus);

            if (orderStatus) {
                order = await OrderService.updateOrder(order, {
                    orderStatus: changeStatusTo ?? orderStatus,
                });
            }

        } catch (error) {
            console.error(`PayPal refund error for order ${order.orderId}:`, error);
        }

        return order;
    }


    static async createPaymentIntent(order: Order): Promise<Order> {
        const token = await this.getAccessToken();

        const res = await axios.post(
            `${this.PAYPAL_API_URL}/v2/checkout/orders`,
            {
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        amount: {
                            currency_code: 'USD',
                            value: order.totalAmount.toFixed(2),
                        },
                        reference_id: order.orderId,
                    },
                ],
                application_context: {
                    return_url: 'https://yourapp.com/success',
                    cancel_url: 'https://yourapp.com/cancel',
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const approvalLink = res.data.links.find((l: any) => l.rel === 'approve')?.href;
        const paypalOrderId = res.data.id;

        return await OrderService.updateOrder(order, {
            paymentMethod: 'PAYPAL',
            paypalOrderId,
            paypalApprovalUrl: approvalLink,
            orderStatus: OrderStatus.PENDING,
        });

    }
}
