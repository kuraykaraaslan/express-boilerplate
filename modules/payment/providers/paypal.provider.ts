import axios, { AxiosInstance } from 'axios';
import { BasePaymentProvider } from './base.provider';
import type { CreateCheckoutParams, CheckoutSessionResult } from '../payment.types';
import { PaymentMessages } from '../payment.messages';
import { env } from '@/libs/env';

export default class PaypalProvider extends BasePaymentProvider {
  readonly name = 'paypal';

  private static accessToken: string | null = null;
  private static accessTokenExpires: Date | null = null;

  private static getBaseUrl(): string {
    return 'https://api-m.sandbox.paypal.com';
  }

  private async getAccessToken(): Promise<string> {
    if (
      PaypalProvider.accessToken &&
      PaypalProvider.accessTokenExpires &&
      PaypalProvider.accessTokenExpires > new Date()
    ) {
      return PaypalProvider.accessToken;
    }

    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(PaymentMessages.PROVIDER_NOT_CONFIGURED);
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await axios.post(
      `${PaypalProvider.getBaseUrl()}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    PaypalProvider.accessToken = res.data.access_token;
    PaypalProvider.accessTokenExpires = new Date(Date.now() + res.data.expires_in * 1000);
    return res.data.access_token;
  }

  private async getAuthenticatedAxios(): Promise<AxiosInstance> {
    const token = await this.getAccessToken();
    return axios.create({
      baseURL: PaypalProvider.getBaseUrl(),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  async getPaymentStatus(externalId: string): Promise<string> {
    const client = await this.getAuthenticatedAxios();
    const response = await client.get(`/v2/checkout/orders/${externalId}`);
    return response.data.status;
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult> {
    const client = await this.getAuthenticatedAxios();

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: params.paymentId,
          amount: {
            currency_code: params.currency.toUpperCase(),
            value: params.amount.toFixed(2),
          },
        },
      ],
      application_context: {
        return_url: params.successUrl ?? 'https://example.com/success',
        cancel_url: params.cancelUrl ?? 'https://example.com/cancel',
        user_action: 'PAY_NOW',
      },
    };

    const response = await client.post('/v2/checkout/orders', body);
    const approveLink = response.data.links?.find((l: { rel: string; href: string }) => l.rel === 'approve');

    return {
      checkoutUrl: approveLink?.href ?? '',
      externalId: response.data.id,
    };
  }
}
