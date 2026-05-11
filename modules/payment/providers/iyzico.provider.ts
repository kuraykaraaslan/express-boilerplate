import CryptoJS from 'crypto-js';
import axios, { AxiosInstance } from 'axios';
import { BasePaymentProvider } from './base.provider';
import type { CreateCheckoutParams, CheckoutSessionResult } from '../payment.types';
import { PaymentMessages } from '../payment.messages';
import { env } from '@/libs/env';

export default class IyzicoProvider extends BasePaymentProvider {
  readonly name = 'iyzico';

  private getConfig(): { apiKey: string; secretKey: string; baseUrl: string } {
    const apiKey = env.IYZICO_API_KEY;
    const secretKey = env.IYZICO_SECRET_KEY;
    const baseUrl = env.IYZICO_BASE_URL ?? 'https://sandbox-api.iyzipay.com';

    if (!apiKey || !secretKey) {
      throw new Error(PaymentMessages.PROVIDER_NOT_CONFIGURED);
    }

    return { apiKey, secretKey, baseUrl };
  }

  private static generateAuthorizationString(
    apiKey: string,
    secretKey: string,
    payload: string,
    uriPath: string,
  ): { authorization: string; 'x-iyzi-rnd': string } {
    const randomKey = `${Date.now()}123456789`;
    const fullPayload = randomKey + uriPath + payload;
    const signature = CryptoJS.HmacSHA256(fullPayload, secretKey).toString();
    const authStr = `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`;
    const encoded = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(authStr));

    return {
      authorization: `IYZWSv2 ${encoded}`,
      'x-iyzi-rnd': randomKey,
    };
  }

  private getAuthenticatedAxios(): AxiosInstance {
    const config = this.getConfig();

    const client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    client.interceptors.request.use((reqConfig) => {
      const uriPath = reqConfig.url!;
      const payload = reqConfig.data ? JSON.stringify(reqConfig.data) : '';
      const auth = IyzicoProvider.generateAuthorizationString(config.apiKey, config.secretKey, payload, uriPath);
      reqConfig.headers['authorization'] = auth.authorization;
      reqConfig.headers['x-iyzi-rnd'] = auth['x-iyzi-rnd'];
      return reqConfig;
    });

    return client;
  }

  async getPaymentStatus(externalId: string): Promise<string> {
    const client = this.getAuthenticatedAxios();
    const path = '/payment/iyzipos/checkoutform/auth/ecom/detail';
    const response = await client.post(path, {
      locale: 'tr',
      conversationId: externalId,
      token: externalId,
    });
    return response.data.status;
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult> {
    const client = this.getAuthenticatedAxios();
    const path = '/payment/iyzipos/checkoutform/initialize/auth/ecom';

    const body = {
      locale: 'tr',
      conversationId: params.paymentId,
      price: params.amount.toFixed(2),
      paidPrice: params.amount.toFixed(2),
      currency: params.currency.toUpperCase() === 'TRY' ? 'TRY' : 'USD',
      basketId: params.paymentId,
      paymentGroup: 'PRODUCT',
      callbackUrl: params.successUrl ?? 'https://example.com/success',
      buyer: {
        id: params.userId,
        name: 'Buyer',
        surname: 'User',
        email: params.metadata?.email ?? 'buyer@example.com',
        identityNumber: '00000000000',
        registrationAddress: 'N/A',
        city: 'Istanbul',
        country: 'Turkey',
        ip: '127.0.0.1',
      },
      shippingAddress: {
        contactName: 'Buyer User',
        city: 'Istanbul',
        country: 'Turkey',
        address: 'N/A',
      },
      billingAddress: {
        contactName: 'Buyer User',
        city: 'Istanbul',
        country: 'Turkey',
        address: 'N/A',
      },
      basketItems: [
        {
          id: params.paymentId,
          name: `Payment ${params.paymentId}`,
          category1: 'General',
          itemType: 'VIRTUAL',
          price: params.amount.toFixed(2),
        },
      ],
    };

    const response = await client.post(path, body);

    return {
      checkoutUrl: response.data.paymentPageUrl ?? response.data.checkoutFormContent ?? '',
      externalId: response.data.token ?? params.paymentId,
    };
  }
}
