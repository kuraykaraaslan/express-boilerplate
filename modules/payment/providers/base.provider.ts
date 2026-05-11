import type { CreateCheckoutParams, CheckoutSessionResult } from '../payment.types';

export abstract class BasePaymentProvider {
  abstract readonly name: string;
  abstract createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult>;
  abstract getPaymentStatus(externalId: string): Promise<string>;
}

export type { CreateCheckoutParams, CheckoutSessionResult };
