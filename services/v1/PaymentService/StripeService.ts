import { Order, OrderStatus } from '@prisma/client';
import OrderService from '@/services/v1/SubscriptionService';
import Stripe from 'stripe';
import { Or } from '@prisma/client/runtime/library';

/**
 * Service class for handling Stripe-related payment operations,
 * including order validation and refund processing.
 */
export default class StripeService {

  private static readonly stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);

  private static isOrderValid(order: Order): boolean {
    return (
      order.paymentMethod === 'STRIPE' &&
      order.orderStatus !== OrderStatus.REFUNDED &&
      order.orderStatus !== OrderStatus.CANCELLED &&
      !!order.stripePaymentIntentId
    );
  }

  private static mapStripeStatusToOrderStatus(status: string): OrderStatus | null {
    switch (status) {
      case 'succeeded': return OrderStatus.COMPLETED;
      case 'requires_payment_method':
      case 'requires_action':
      case 'processing':
        return OrderStatus.PENDING;
      case 'canceled':
        return OrderStatus.CANCELLED;
      default:
        return null;
    }
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
          const response = await this.stripeClient.paymentIntents.retrieve(order.stripePaymentIntentId!);

          const orderStatus = this.mapStripeStatusToOrderStatus(response.status);

          if (orderStatus === OrderStatus.COMPLETED) {
            order = await OrderService.updateOrder(order, { orderStatus });
          } 

        } catch (error) {
          console.error(`Stripe validation error for order ${order.orderId}:`, error);
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
        try {
          const refund = await this.stripeClient.refunds.create({
            payment_intent: order.stripePaymentIntentId!,
          });

          if (refund.status === 'succeeded') {
            order = await OrderService.updateOrder(order, {
              orderStatus: changeStatusTo ?? OrderStatus.REFUNDED,
            });
          }

        } catch (error) {
          console.error(`Stripe refund error for order ${order.orderId}:`, error);
        }

        return order;
      })
    );
  }


  static async createPaymentIntent(order: Order): Promise<Order> {
    const paymentIntent = await this.stripeClient.paymentIntents.create({
      amount: Math.round(order.totalAmount * 100), // convert to cents
      currency: 'usd', // or order.currency if you have one
      metadata: {
        orderId: order.orderId,
      },
    });

   

  }
}

