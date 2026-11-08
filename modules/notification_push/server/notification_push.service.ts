import 'reflect-metadata';
import type { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import { type PushPayload, isPushEnabled } from './notification_push.config';
import type { RegisterPushTokenInput } from './notification_push.dto';
import {
  getSubscriptionsForUser, subscribe, unsubscribe, unsubscribeByEndpoint,
  registerDeviceToken, unregisterDeviceToken, updateDeviceTokenCategories,
} from './notification_push.subscription.service';
import {
  isWithinQuietHours, getDeliveryMetrics, type DeliveryMetrics, listStaleSubscriptions,
} from './notification_push.metrics.service';
import {
  sendToUser, sendToUsers, sendToRole, sendToAdmins, sendToAll,
} from './notification_push.send.service';

export type { PushPayload };

/**
 * Push-notification service facade. The implementation is split across focused
 * modules (`notification_push.config`, `.subscription.service`, `.metrics.service`,
 * `.send.service`); this class preserves the single `NotificationPushService.*`
 * entry point its callers depend on.
 */
export default class NotificationPushService {
  static isPushEnabled(tenantId: string): Promise<boolean> {
    return isPushEnabled(tenantId);
  }

  static getSubscriptionsForUser(tenantId: string, userId: string): Promise<PushSubscriptionEntity[]> {
    return getSubscriptionsForUser(tenantId, userId);
  }

  static subscribe(
    tenantId: string,
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    opts?: { categories?: string[]; consent?: boolean },
  ): Promise<void> {
    return subscribe(tenantId, userId, subscription, opts);
  }

  static unsubscribe(tenantId: string, userId: string): Promise<void> {
    return unsubscribe(tenantId, userId);
  }

  static unsubscribeByEndpoint(tenantId: string, endpoint: string, userId?: string): Promise<void> {
    return unsubscribeByEndpoint(tenantId, endpoint, userId);
  }

  static registerDeviceToken(tenantId: string, userId: string, input: RegisterPushTokenInput, userSessionId?: string): Promise<void> {
    return registerDeviceToken(tenantId, userId, input, userSessionId);
  }

  static unregisterDeviceToken(tenantId: string, userId: string, by: { deviceId?: string; token?: string }): Promise<void> {
    return unregisterDeviceToken(tenantId, userId, by);
  }

  static updateDeviceTokenCategories(tenantId: string, userId: string, by: { deviceId?: string; token?: string }, categories: string[]): Promise<number> {
    return updateDeviceTokenCategories(tenantId, userId, by, categories);
  }

  static isWithinQuietHours(tenantId: string, userId: string): Promise<boolean> {
    return isWithinQuietHours(tenantId, userId);
  }

  static getDeliveryMetrics(tenantId: string): Promise<DeliveryMetrics> {
    return getDeliveryMetrics(tenantId);
  }

  static listStaleSubscriptions(tenantId: string, days = 90): Promise<number> {
    return listStaleSubscriptions(tenantId, days);
  }

  static sendToUser(
    tenantId: string,
    userId: string,
    payload: PushPayload,
    opts?: { category?: string; respectQuietHours?: boolean },
  ): Promise<void> {
    return sendToUser(tenantId, userId, payload, opts);
  }

  static sendToUsers(tenantId: string, userIds: string[], payload: PushPayload): Promise<void> {
    return sendToUsers(tenantId, userIds, payload);
  }

  static sendToRole(tenantId: string, role: string, payload: PushPayload): Promise<void> {
    return sendToRole(tenantId, role, payload);
  }

  static sendToAdmins(tenantId: string, payload: PushPayload): Promise<void> {
    return sendToAdmins(tenantId, payload);
  }

  static sendToAll(tenantId: string, payload: PushPayload): Promise<void> {
    return sendToAll(tenantId, payload);
  }
}
