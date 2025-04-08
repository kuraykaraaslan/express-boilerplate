import { Order, OrderStatus } from '@prisma/client';
import OrderService from '@/services/v1/OrderService';
import axios from 'axios';
import crypto from 'crypto';

/**
 * Service class for handling Iyzico-related payment operations,
 * including order validation and refund processing.
 */
export default class IyzicoService {

    private static readonly API_KEY = process.env.IYZICO_API_KEY!;
    private static readonly SECRET_KEY = process.env.IYZICO_SECRET_KEY!;
    private static readonly BASE_URL = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';

    private static isOrderValid(order: Order): boolean {
        return (
            order.paymentMethod === 'IYZICO' &&
            order.orderStatus !== OrderStatus.REFUNDED &&
            order.orderStatus !== OrderStatus.CANCELLED &&
            !!order.iyzicoPaymentId
        );
    }

    private static mapIyzicoStatusToOrderStatus(status: string): OrderStatus | null {
        switch (status) {
            case 'SUCCESS': return OrderStatus.COMPLETED;
            case 'FAILURE': return OrderStatus.CANCELLED;
            default: return null;
        }
    }

    private static generateHeaders(body: string = '') {
        const random = crypto.randomBytes(8).toString('base64');
        const hashStr = `${this.API_KEY}${random}${this.SECRET_KEY}${body}`;
        const hash = crypto.createHash('sha1').update(hashStr).digest('base64');
        const auth = `IYZWS ${this.API_KEY}:${hash}`;

        return {
            Authorization: auth,
            'x-iyzi-rnd': random,
            'Content-Type': 'application/json',
        };
    }

    static async validateOrderStatus({
        orders,
    }: {
        orders: Order[];
    }): Promise<Order[]> {
        return await Promise.all(
            orders.map(async (order) => {

                if (!this.isOrderValid(order)) return order;

                try {
                    const body = JSON.stringify({
                        locale: 'en',
                        conversationId: order.orderId,
                        paymentId: order.iyzicoPaymentId,
                    });

                    const response = await axios.post(
                        `${this.BASE_URL}/payment/detail`,
                        body,
                        { headers: this.generateHeaders(body) }
                    );

                    const iyzicoStatus = response.data.paymentStatus;
                    const orderStatus = this.mapIyzicoStatusToOrderStatus(iyzicoStatus);

                    if (orderStatus === OrderStatus.COMPLETED) {
                        order = await OrderService.updateOrder(order, { orderStatus });
                    }

                } catch (error) {
                    console.error(`Iyzico validation error for order ${order.orderId}`, error);
                }

                return order;
            })
        );
    }

    static async refundOrders({
        orders,
        changeStatusTo,
    }: {
        orders: Order[];
        changeStatusTo?: OrderStatus | null;
    }): Promise<Order[]> {
        return await Promise.all(
            orders.map(async (order) => {
                if (!this.isOrderValid(order)) return order;

                try {
                    const body = JSON.stringify({
                        locale: 'en',
                        conversationId: order.orderId,
                        paymentTransactionId: order.iyzicoPaymentId,
                        price: order.totalAmount,
                    });

                    const response = await axios.post(
                        `${this.BASE_URL}/payment/refund`,
                        body,
                        { headers: this.generateHeaders(body) }
                    );

                    if (response.data.status === 'success') {
                        order = await OrderService.updateOrder(order, {
                            orderStatus: changeStatusTo ?? OrderStatus.REFUNDED,
                        });
                    }

                } catch (error) {
                    console.error(`Iyzico refund error for order ${order.orderId}`, error);
                }

                return order;
            })
        );
    }


    static async createPaymentIntent(order: Order): Promise<Order> {
        const body = JSON.stringify({
            locale: 'en',
            conversationId: order.orderId,
            price: order.totalAmount,
            paidPrice: order.totalAmount,
            currency: 'USD',
            basketId: order.orderId,
            paymentGroup: 'PRODUCT',
            callbackUrl: 'https://yourapp.com/iyzico-callback',
            buyer: {
                id: order.userId,
                name: 'John',
                surname: 'Doe',
                email: 'john.doe@example.com',
                identityNumber: '11111111111',
                registrationAddress: 'Test Address',
                ip: '85.34.78.112',
                city: 'Istanbul',
                country: 'Turkey',
            },
            shippingAddress: {
                contactName: 'John Doe',
                city: 'Istanbul',
                country: 'Turkey',
                address: 'Test Address',
            },
            billingAddress: {
                contactName: 'John Doe',
                city: 'Istanbul',
                country: 'Turkey',
                address: 'Test Address',
            },
            basketItems: [
                {
                    id: '1',
                    name: 'Order',
                    category1: 'General',
                    itemType: 'VIRTUAL',
                    price: order.totalAmount,
                },
            ],
        });

        const response = await axios.post(
            `${this.BASE_URL}/payment/iyzipos/checkoutform/initialize/auth/ecom`,
            body,
            { headers: this.generateHeaders(body) }
        );

        if (response.data.status !== 'success') {
            throw new Error('IYZICO_PAYMENT_CREATION_FAILED');
        }

        return await OrderService.updateOrder(order, {
            paymentMethod: 'IYZICO',
            iyzicoPaymentId: response.data.paymentId,
            iyzicoToken: response.data.token,
            orderStatus: OrderStatus.PENDING,
        });

      
    }
}