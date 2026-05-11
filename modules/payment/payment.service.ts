import 'reflect-metadata';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { Logger } from '@/libs/logger';
import { env } from '@/libs/env';
import { Payment } from './entities/Payment';
import { PaymentMessages } from './payment.messages';
import { PaymentSchema } from './payment.types';
import type { Payment as PaymentType, CheckoutSessionResult, CreateCheckoutParams } from './payment.types';
import type { CreatePaymentInput } from './payment.dto';
import type { PaymentProvider, PaymentStatus } from './payment.enums';
import { BasePaymentProvider } from './providers/base.provider';
import StripeProvider from './providers/stripe.provider';
import PaypalProvider from './providers/paypal.provider';
import IyzicoProvider from './providers/iyzico.provider';

export default class PaymentService {
  private static readonly stripeProvider = new StripeProvider();
  private static readonly paypalProvider = new PaypalProvider();
  private static readonly iyzicoProvider = new IyzicoProvider();

  private static readonly PROVIDERS = new Map<PaymentProvider, BasePaymentProvider>([
    ['STRIPE', PaymentService.stripeProvider],
    ['PAYPAL', PaymentService.paypalProvider],
    ['IYZICO', PaymentService.iyzicoProvider],
  ]);

  private static get repo() {
    return AppDataSource.getRepository(Payment);
  }

  static getProvider(name?: PaymentProvider): BasePaymentProvider {
    const defaultProvider = (env.PAYMENT_DEFAULT_PROVIDER?.toUpperCase() as PaymentProvider) ?? 'STRIPE';
    const providerName = name ?? defaultProvider;
    const provider = PaymentService.PROVIDERS.get(providerName);
    if (!provider) {
      throw new AppError(PaymentMessages.PROVIDER_NOT_CONFIGURED, 400, ErrorCode.INTERNAL_ERROR);
    }
    return provider;
  }

  static async create(data: CreatePaymentInput): Promise<PaymentType> {
    const repo = PaymentService.repo;
    const payment = repo.create({
      tenantId: data.tenantId,
      userId: data.userId,
      amount: data.amount,
      currency: data.currency ?? 'USD',
      provider: data.provider ?? ((env.PAYMENT_DEFAULT_PROVIDER?.toUpperCase() as PaymentProvider) ?? 'STRIPE'),
      status: 'PENDING',
    });
    const saved = await repo.save(payment);
    return PaymentSchema.parse(saved);
  }

  static async findById(paymentId: string): Promise<PaymentType> {
    const payment = await PaymentService.repo.findOne({ where: { paymentId } });
    if (!payment) {
      throw new AppError(PaymentMessages.PAYMENT_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    return PaymentSchema.parse(payment);
  }

  static async findByTenant(tenantId: string): Promise<PaymentType[]> {
    const payments = await PaymentService.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
    return payments.map((p) => PaymentSchema.parse(p));
  }

  static async createCheckoutSession(paymentId: string): Promise<CheckoutSessionResult> {
    const payment = await PaymentService.findById(paymentId);
    const provider = PaymentService.getProvider(payment.provider as PaymentProvider);

    const params: CreateCheckoutParams = {
      paymentId: payment.paymentId,
      amount: Number(payment.amount),
      currency: payment.currency,
      tenantId: payment.tenantId,
      userId: payment.userId,
    };

    const result = await provider.createCheckoutSession(params);

    await PaymentService.repo.update(
      { paymentId },
      {
        checkoutUrl: result.checkoutUrl,
        externalId: result.externalId,
        status: 'PROCESSING',
      } as any,
    );

    return result;
  }

  static async updateStatus(paymentId: string, status: PaymentStatus, externalId?: string): Promise<PaymentType> {
    const existing = await PaymentService.findById(paymentId);

    const updateData: Partial<Payment> = { status } as Partial<Payment>;
    if (externalId) updateData.externalId = externalId;

    await PaymentService.repo.update({ paymentId }, updateData as any);

    const updated = await PaymentService.repo.findOne({ where: { paymentId } });
    return PaymentSchema.parse(updated!);
  }

  static async handleWebhook(provider: string, payload: unknown): Promise<void> {
    try {
      const paymentProvider = PaymentService.getProvider(provider.toUpperCase() as PaymentProvider);

      if (typeof payload === 'object' && payload !== null) {
        const data = payload as Record<string, unknown>;
        const externalId = (data.id ?? data.token ?? data.paymentId) as string | undefined;

        if (externalId) {
          const rawStatus = await paymentProvider.getPaymentStatus(externalId);
          const normalizedStatus = PaymentService.normalizeStatus(rawStatus);

          const payment = await PaymentService.repo.findOne({ where: { externalId } });
          if (payment) {
            await PaymentService.updateStatus(payment.paymentId, normalizedStatus);
          }
        }
      }
    } catch (err) {
      Logger.error(`[Payment] Webhook processing failed for provider ${provider}: ${err}`);
    }
  }

  private static normalizeStatus(providerStatus: string): PaymentStatus {
    const status = providerStatus.toUpperCase();
    if (status === 'COMPLETED' || status === 'CAPTURED' || status === 'APPROVED' || status === 'SUCCESS') {
      return 'COMPLETED';
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'DECLINED') {
      return 'FAILED';
    }
    if (status === 'REFUNDED') {
      return 'REFUNDED';
    }
    if (status === 'PROCESSING' || status === 'PENDING') {
      return 'PROCESSING';
    }
    return 'PENDING';
  }
}
