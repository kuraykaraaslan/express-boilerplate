import 'reflect-metadata';
import { LessThan } from 'typeorm';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { TenantSubscription as TenantSubscriptionEntity } from './entities/TenantSubscription';
import { SubscriptionPlan as SubscriptionPlanEntity } from './entities/SubscriptionPlan';
import { TenantSubscriptionMessages } from './tenant_subscription.messages';
import { TenantSubscriptionSchema, SubscriptionPlanSchema } from './tenant_subscription.types';
import type { TenantSubscription, SubscriptionPlan } from './tenant_subscription.types';
import type { SubscriptionStatus } from './tenant_subscription.enums';

export default class TenantSubscriptionService {
  private static get subRepo() {
    return AppDataSource.getRepository(TenantSubscriptionEntity);
  }

  private static get planRepo() {
    return AppDataSource.getRepository(SubscriptionPlanEntity);
  }

  static async findByTenant(tenantId: string): Promise<TenantSubscription | null> {
    const sub = await TenantSubscriptionService.subRepo.findOne({ where: { tenantId } });
    if (!sub) return null;
    return TenantSubscriptionSchema.parse(sub);
  }

  static async createTrialSubscription(tenantId: string, trialDays: number = 14): Promise<TenantSubscription> {
    const repo = TenantSubscriptionService.subRepo;

    const existing = await repo.findOne({ where: { tenantId } });
    if (existing) {
      return TenantSubscriptionSchema.parse(existing);
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const entity = repo.create({
      tenantId,
      status: 'TRIAL',
      trialEndsAt,
      cancelAtPeriodEnd: false,
    });

    const saved = await repo.save(entity);
    return TenantSubscriptionSchema.parse(saved);
  }

  static async updateStatus(tenantId: string, status: SubscriptionStatus): Promise<TenantSubscription> {
    const repo = TenantSubscriptionService.subRepo;

    const existing = await repo.findOne({ where: { tenantId } });
    if (!existing) {
      throw new AppError(TenantSubscriptionMessages.SUBSCRIPTION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.update({ tenantId }, { status });

    const updated = await repo.findOne({ where: { tenantId } });
    return TenantSubscriptionSchema.parse(updated!);
  }

  static async cancelSubscription(tenantId: string): Promise<TenantSubscription> {
    const repo = TenantSubscriptionService.subRepo;

    const existing = await repo.findOne({ where: { tenantId } });
    if (!existing) {
      throw new AppError(TenantSubscriptionMessages.SUBSCRIPTION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.update({ tenantId }, { cancelAtPeriodEnd: true });

    const updated = await repo.findOne({ where: { tenantId } });
    return TenantSubscriptionSchema.parse(updated!);
  }

  static async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const sub = await TenantSubscriptionService.subRepo.findOne({ where: { tenantId } });
    if (!sub) return false;

    if (sub.status === 'ACTIVE') return true;

    if (sub.status === 'TRIAL' && sub.trialEndsAt) {
      return new Date() < new Date(sub.trialEndsAt);
    }

    return false;
  }

  static async expireTrials(): Promise<number> {
    const repo = TenantSubscriptionService.subRepo;
    const now = new Date();

    const expiredTrials = await repo.find({
      where: {
        status: 'TRIAL',
        trialEndsAt: LessThan(now),
      },
    });

    if (expiredTrials.length === 0) return 0;

    for (const sub of expiredTrials) {
      await repo.update({ tenantId: sub.tenantId }, { status: 'EXPIRED' });
    }

    return expiredTrials.length;
  }

  static async findAllPlans(): Promise<SubscriptionPlan[]> {
    const plans = await TenantSubscriptionService.planRepo.find({
      where: { isActive: true },
      order: { monthlyPrice: 'ASC' },
    });
    return plans.map((p) => SubscriptionPlanSchema.parse(p));
  }

  static async findPlanById(planId: string): Promise<SubscriptionPlan> {
    const plan = await TenantSubscriptionService.planRepo.findOne({ where: { planId } });
    if (!plan) {
      throw new AppError(TenantSubscriptionMessages.PLAN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    return SubscriptionPlanSchema.parse(plan);
  }
}
