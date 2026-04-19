import {Injectable, Logger} from '@nestjs/common';
import webPush from 'web-push';
import {db} from '../db.js';
import {config} from '../config.js';
import type {DialogRow} from './dialogs.js';
import type {ChatContextMessagePayload} from '../ws/chat/chat-context.js';

type PushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type SendChatPushParams = {
  dialog: DialogRow;
  message: ChatContextMessagePayload;
  senderId: number;
  excludeUserIds?: number[];
};

type StoredPushSubscription = {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSendError = {
  subscriptionId: number;
  userId: number;
  endpointShort: string;
  statusCode: number;
  message: string;
  removed: boolean;
};

export type SendTestPushResult = {
  ok: true;
  totalSubscriptions: number;
  successCount: number;
  errorCount: number;
  errors: PushSendError[];
} | {
  ok: false;
  error: 'no_subscriptions';
};

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);

  constructor() {
    this.initVapid();
  }

  getPublicConfig() {
    return {
      ok: true,
      enabled: true,
      vapidPublicKey: config.push.vapidPublicKey,
    };
  }

  async upsertSubscription(userId: number, subscription: PushSubscriptionPayload, userAgentRaw?: unknown) {
    const now = new Date();
    const userAgent = String(userAgentRaw || '').trim() || null;

    await db.pushSubscription.upsert({
      where: {
        endpoint: subscription.endpoint,
      },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
        lastUsedAt: now,
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
        lastUsedAt: now,
      },
    });

    this.logger.log(`Web Push subscription upsert userId=${userId} endpoint=${this.shortEndpoint(subscription.endpoint)}`);
    return {ok: true} as const;
  }

  async removeSubscription(userId: number, endpointRaw: unknown) {
    const endpoint = String(endpointRaw || '').trim();
    if (!endpoint) {
      return {ok: false, error: 'invalid_endpoint'} as const;
    }

    const result = await db.pushSubscription.deleteMany({
      where: {
        userId,
        endpoint,
      },
    });

    this.logger.log(`Web Push subscription remove userId=${userId} endpoint=${this.shortEndpoint(endpoint)} removed=${result.count}`);
    return {
      ok: true,
      removed: result.count,
    } as const;
  }

  async sendChatMessagePush(params: SendChatPushParams) {
    try {
      const recipientUserIds = await this.resolveRecipientUserIds(params.dialog, params.senderId);
      const excluded = new Set(
        Array.isArray(params.excludeUserIds)
          ? params.excludeUserIds.filter((value) => Number.isFinite(value) && value > 0)
          : [],
      );
      const filteredRecipientUserIds = recipientUserIds.filter((userId) => !excluded.has(userId));
      this.logger.log(`Web Push chat recipients=${recipientUserIds.length} dialogId=${params.dialog.id}`);
      this.logger.log(`Web Push chat recipients_after_exclude=${filteredRecipientUserIds.length} dialogId=${params.dialog.id}`);
      if (!filteredRecipientUserIds.length) return;

      const subscriptions = await this.findSubscriptionsByUserIds(filteredRecipientUserIds);
      this.logger.log(`Web Push chat subscriptions=${subscriptions.length} dialogId=${params.dialog.id}`);

      if (!subscriptions.length) return;

      for (const subscription of subscriptions) {
        const url = this.buildUrlForRecipient(params.dialog, params.message, subscription.userId);
        const payload = this.buildNotificationPayload(params.message, params.dialog, url);

        const sendResult = await this.sendToSubscription({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        }, payload);

        if (sendResult.ok) {
          this.logger.log(`Web Push chat success userId=${subscription.userId} subscriptionId=${subscription.id}`);
          await db.pushSubscription.update({
            where: {
              id: subscription.id,
            },
            data: {
              lastUsedAt: new Date(),
            },
          });
          continue;
        }

        const removed = sendResult.statusCode === 404 || sendResult.statusCode === 410;
        if (removed) {
          await db.pushSubscription.deleteMany({
            where: {
              id: subscription.id,
            },
          });
        }

        this.logger.warn(
          `Web Push chat failed userId=${subscription.userId} subscriptionId=${subscription.id} statusCode=${sendResult.statusCode || 'unknown_status'} message="${sendResult.message}" removed=${removed}`
        );
      }
    } catch (error: any) {
      this.logger.error(error?.message || String(error));
    }
  }

  async sendTestPushToUser(userId: number): Promise<SendTestPushResult> {
    const subscriptions = await this.findSubscriptionsByUserIds([userId]);
    if (!subscriptions.length) {
      this.logger.warn(`Web Push test no subscriptions userId=${userId}`);
      return {ok: false, error: 'no_subscriptions'};
    }

    const payload = {
      title: 'MARX TEST',
      body: 'Тестовое push-уведомление',
      url: '/chat',
      tag: 'marx-test-push',
    };

    let successCount = 0;
    const errors: PushSendError[] = [];

    this.logger.log(`Web Push test start userId=${userId} subscriptions=${subscriptions.length}`);
    for (const subscription of subscriptions) {
      const sendResult = await this.sendToSubscription({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, payload);

      if (sendResult.ok) {
        successCount += 1;
        this.logger.log(`Web Push test success userId=${subscription.userId} subscriptionId=${subscription.id}`);
        await db.pushSubscription.update({
          where: {
            id: subscription.id,
          },
          data: {
            lastUsedAt: new Date(),
          },
        });
        continue;
      }

      const removed = sendResult.statusCode === 404 || sendResult.statusCode === 410;
      if (removed) {
        await db.pushSubscription.deleteMany({
          where: {
            id: subscription.id,
          },
        });
      }

      this.logger.warn(
        `Web Push test failed userId=${subscription.userId} subscriptionId=${subscription.id} statusCode=${sendResult.statusCode || 'unknown_status'} message="${sendResult.message}" removed=${removed}`
      );

      errors.push({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        endpointShort: this.shortEndpoint(subscription.endpoint),
        statusCode: sendResult.statusCode,
        message: sendResult.message,
        removed,
      });
    }

    return {
      ok: true,
      totalSubscriptions: subscriptions.length,
      successCount,
      errorCount: errors.length,
      errors,
    };
  }

  private initVapid() {
    const vapidPublicKey = String(config.push.vapidPublicKey || '').trim();
    const vapidPrivateKey = String(config.push.vapidPrivateKey || '').trim();
    const vapidSubject = String(config.push.vapidSubject || '').trim();

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new Error('Web Push VAPID keys are not configured. Set push.vapidPublicKey, push.vapidPrivateKey and push.vapidSubject.');
    }

    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    this.logger.log('Web Push enabled');
  }

  private async resolveRecipientUserIds(dialog: DialogRow, senderId: number) {
    if (dialog.kind === 'private') {
      const ids = [dialog.member_a, dialog.member_b]
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0 && value !== senderId);
      return Array.from(new Set(ids));
    }

    if (dialog.kind === 'general') {
      const users = await db.user.findMany({
        where: {
          id: {
            not: senderId,
          },
        },
        select: {
          id: true,
        },
      });
      return users.map((item) => item.id);
    }

    return [];
  }

  private buildUrlForRecipient(dialog: DialogRow, message: ChatContextMessagePayload, recipientUserId: number) {
    if (dialog.kind === 'private') {
      if (recipientUserId === message.authorId) {
        return '/chat';
      }

      const nickname = String(message.authorNickname || '').trim().toLowerCase();
      if (nickname) {
        return `/direct/${encodeURIComponent(nickname)}`;
      }
    }

    return '/chat';
  }

  private buildNotificationPayload(message: ChatContextMessagePayload, dialog: DialogRow, url: string) {
    const preview = this.buildBodyPreview(message.rawText);
    const authorName = String(message.authorName || message.authorNickname || 'Кто-то').trim() || 'Кто-то';

    return {
      title: dialog.kind === 'general' ? 'MARX · Общий чат' : 'MARX · Директ',
      body: `${authorName}: ${preview}`,
      url,
      dialogId: message.dialogId,
      messageId: message.id,
      authorId: message.authorId,
      icon: '/favicon-alert.png',
      badge: '/pwa-192.png',
      tag: `marx-message-${message.dialogId}`,
    };
  }

  private buildBodyPreview(rawTextRaw: unknown) {
    const normalized = String(rawTextRaw || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '(пусто)';
    if (normalized.length <= 120) return normalized;
    return `${normalized.slice(0, 117)}...`;
  }

  private shortEndpoint(endpointRaw: unknown) {
    const endpoint = String(endpointRaw || '').trim();
    if (!endpoint) return 'empty';
    if (endpoint.length <= 40) return endpoint;
    return `${endpoint.slice(0, 18)}...${endpoint.slice(-12)}`;
  }

  private normalizeErrorMessage(errorRaw: unknown) {
    const value = String(errorRaw || '').replace(/\s+/g, ' ').trim();
    if (!value) return 'unknown_error';
    if (value.length <= 220) return value;
    return `${value.slice(0, 217)}...`;
  }

  private async findSubscriptionsByUserIds(userIds: number[]) {
    if (!userIds.length) return [] as StoredPushSubscription[];

    return db.pushSubscription.findMany({
      where: {
        userId: {
          in: userIds,
        },
      },
      select: {
        id: true,
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    });
  }

  private async sendToSubscription(subscription: PushSubscriptionPayload, payload: Record<string, unknown>) {
    try {
      await webPush.sendNotification(subscription as any, JSON.stringify(payload), {
        TTL: 120,
        urgency: 'normal',
      });
      return {ok: true, statusCode: 0, message: ''} as const;
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || 0);
      return {
        ok: false,
        statusCode,
        message: this.normalizeErrorMessage(error?.message || error?.body || error),
      } as const;
    }
  }
}
