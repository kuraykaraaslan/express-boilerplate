import axios, { AxiosInstance } from 'axios';
import qs from 'querystring';
import { BasePaymentProvider } from './base.provider';
import type { CreateCheckoutParams, CheckoutSessionResult } from '../payment.types';
import { PaymentMessages } from '../payment.messages';
import { env } from '@/libs/env';

export default class StripeProvider extends BasePaymentProvider {
  readonly name = 'stripe';

  private static readonly STRIPE_API_URL = 'https://api.stripe.com/v1';

  private getAxiosInstance(): AxiosInstance {
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(PaymentMessages.PROVIDER_NOT_CONFIGURED);
    }
    return axios.create({
      baseURL: StripeProvider.STRIPE_API_URL,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  async getPaymentStatus(externalId: string): Promise<string> {
    const client = this.getAxiosInstance();
    const response = await client.get(`/payment_intents/${externalId}`);
    return response.data.status;
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult> {
    const client = this.getAxiosInstance();

    const body: Record<string, unknown> = {
      'mode': 'payment',
      'line_items[0][price_data][currency]': params.currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': `Payment ${params.paymentId}`,
      'line_items[0][price_data][unit_amount]': Math.round(params.amount * 100),
      'line_items[0][quantity]': 1,
      'success_url': params.successUrl ?? 'https://example.com/success',
      'cancel_url': params.cancelUrl ?? 'https://example.com/cancel',
      'metadata[paymentId]': params.paymentId,
      'metadata[tenantId]': params.tenantId,
    };

    if (params.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        body[`metadata[${key}]`] = value;
      }
    }

    const response = await client.post('/checkout/sessions', qs.stringify(body as Record<string, string>));

    return {
      checkoutUrl: response.data.url,
      externalId: response.data.id,
    };
  }
}
