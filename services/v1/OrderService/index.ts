import { Order, OrderStatus, User } from '@prisma/client';
import prisma from '@/libs/prisma';

// Third-party Services
import StripeService from '@/services/v1/OrderService/StripeService';
import PaypalService from '@/services/v1/OrderService/PaypalService';
import IyzicoService from '@/services/v1/OrderService/IyzicoService';

/**
 * Service class responsible for managing orders and handling payment-specific logic.
 */
export default class OrderService {

    static async listOrdersByUser(user: Pick<User, 'userId'>): Promise<Order[]> {
        return prisma.order.findMany({
            where: { userId: user.userId },
        });
    }

    static async getOrderById(orderId: string): Promise<Order | null> {
        return prisma.order.findUnique({
            where: { orderId },
        });
    }

    static async deleteOrder(orderId: string): Promise<Order> {
        return prisma.order.delete({
            where: { orderId },
        });
    }

    static async updateOrder(
        order: Pick<Order, 'orderId'>,
        data: Partial<Omit<Order, 'orderId'>>
    ): Promise<Order> {
        return prisma.order.update({
            where: { orderId: order.orderId },
            data,
        });
    }

    static async refundOrders({
        orders,
        changeStatusTo,
    }: {
        orders: Order[];
        changeStatusTo?: OrderStatus | null;
    }): Promise<Order[]> {
        const { stripeOrders, paypalOrders, iyzicoOrders } = orders.reduce(
            (acc, order) => {
                switch (order.paymentMethod) {
                    case 'STRIPE':
                        acc.stripeOrders.push(order);
                        break;
                    case 'PAYPAL':
                        acc.paypalOrders.push(order);
                        break;
                    case 'IYZICO':
                        acc.iyzicoOrders.push(order);
                        break;
                    default:
                        console.warn(`Unknown payment method for order ${order.orderId}: ${order.paymentMethod}`);
                        break;
                }
                return acc;
            },
            { stripeOrders: [] as Order[], paypalOrders: [] as Order[], iyzicoOrders: [] as Order[] }
        );

        const [stripeRefunds, paypalRefunds, iyzicoRefunds] = await Promise.all([
            StripeService.refundOrders({ orders: stripeOrders, changeStatusTo }),
            PaypalService.refundOrders({ orders: paypalOrders, changeStatusTo }),
            IyzicoService.refundOrders({ orders: iyzicoOrders, changeStatusTo }),
        ]);

        const allRefunds = [...stripeRefunds, ...paypalRefunds, ...iyzicoRefunds].filter(Boolean);

        if (allRefunds.length !== orders.length) {
            throw new Error('NOT_ALL_ORDERS_REFUNDED');
        }

        return allRefunds;
    }

    /**
     * Switches the payment method of a pending order to another method.
     * Only allowed if the current status is PENDING and the method is changing.
     *
     * @param order - The order to be updated.
     * @param newPaymentMethod - The new payment method to set.
     * @returns The updated order.
     */
    static async switchPaymentMethod(
        order: Order,
        newPaymentMethod: Order['paymentMethod']
    ): Promise<Order> {
        if (order.orderStatus !== OrderStatus.PENDING) {
            throw new Error('ORDER_NOT_PENDING');
        }

        if (order.paymentMethod === newPaymentMethod) {
            return order; // No change needed
        }

        //first validate the order with the previous payment method
        let validatedOrders: Order[] = [];
        switch (order.paymentMethod) {
            case 'STRIPE':
                validatedOrders = await StripeService.validateOrderStatus({
                    orders: [order],
                });
                break;
            case 'PAYPAL':
                validatedOrders = await PaypalService.validateOrderStatus({
                    orders: [order],
                });
                break;
            case 'IYZICO':
                validatedOrders = await IyzicoService.validateOrderStatus({
                    orders: [order],
                });
                break;
            default:
                throw new Error(`Unknown payment method: ${order.paymentMethod}`);
        }

        // Check if the order is still pending after validation
        const validatedOrder = validatedOrders[0];

        if (!validatedOrder || validatedOrder.orderStatus !== OrderStatus.PENDING) {
            throw new Error('ORDER_IS_NOT_AVAILABLE_FOR_SWITCH');
        }

        // Update the order with the new payment method
        const updatedOrder = await prisma.order.update({
            where: { orderId: order.orderId },
            data: {
                paymentMethod: newPaymentMethod,
                orderStatus: OrderStatus.PENDING, // Reset status to PENDING
            },
        });

        return updatedOrder;
    }


    /**
   * Creates a payment intent/order for the given order based on its payment method.
   * Delegates the logic to the appropriate payment service.
   *
   * @param order - The order to initialize a payment for.
   * @returns A Promise resolving to payment initialization data.
   */
    static async createPaymentIntent(order: Order): Promise<Order> {
        if (order.orderStatus !== OrderStatus.PENDING) {
            throw new Error('ORDER_NOT_PENDING');
        }

        switch (order.paymentMethod) {
            case 'STRIPE':
                return await StripeService.createPaymentIntent(order);
            case 'PAYPAL':
                return await PaypalService.createPaymentIntent(order);
            case 'IYZICO':
                return await IyzicoService.createPaymentIntent(order);
            default:
                throw new Error(`UNSUPPORTED_PAYMENT_METHOD: ${order.paymentMethod}`);
        }
    }

}
