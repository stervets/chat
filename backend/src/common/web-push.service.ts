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
  activeDialogUserAgentsByUserId?: Map<number, Set<string>>;
};

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly enabled: boolean;

  constructor() {
    this.enabled = this.initVapid();
  }

  isEnabled() {
    return this.enabled;
  }

  getPublicConfig() {
    if (!this.enabled) {
      return {
        ok: true,
        enabled: false,
      };
    }

    return {
      ok: true,
      enabled: true,
      vapidPublicKey: config.push.vapidPublicKey,
    };
  }

  async upsertSubscription(userId: number, subscription: PushSubscriptionPayload, userAgentRaw?: unknown) {
    if (!this.enabled) {
      return {ok: false, error: 'push_disabled'} as const;
    }

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

    return {
      ok: true,
      removed: result.count,
    } as const;
  }

  async sendChatMessagePush(params: SendChatPushParams) {
    if (!this.enabled) return;

    try {
      const recipientUserIds = await this.resolveRecipientUserIds(params.dialog, params.senderId);
      if (!recipientUserIds.length) return;

      const subscriptions = await db.pushSubscription.findMany({
        where: {
          userId: {
            in: recipientUserIds,
          },
        },
        select: {
          id: true,
          userId: true,
          endpoint: true,
          p256dh: true,
          auth: true,
          userAgent: true,
        },
      });

      if (!subscriptions.length) return;

      for (const subscription of subscriptions) {
        const activeUserAgents = params.activeDialogUserAgentsByUserId?.get(subscription.userId);
        const normalizedUserAgent = String(subscription.userAgent || '').trim();
        if (normalizedUserAgent && activeUserAgents?.has(normalizedUserAgent)) {
          continue;
        }

        const url = this.buildUrlForRecipient(params.dialog, params.message, subscription.userId);
        const payload = this.buildNotificationPayload(params.message, params.dialog, url);

        const statusCode = await this.sendToSubscription({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        }, payload);

        if (statusCode === 404 || statusCode === 410) {
          await db.pushSubscription.deleteMany({
            where: {
              id: subscription.id,
            },
          });
          continue;
        }

        if (statusCode === 0) {
          await db.pushSubscription.update({
            where: {
              id: subscription.id,
            },
            data: {
              lastUsedAt: new Date(),
            },
          });
        }
      }
    } catch (error: any) {
      this.logger.error(error?.message || String(error));
    }
  }

  private initVapid() {
    const vapidPublicKey = String(config.push.vapidPublicKey || '').trim();
    const vapidPrivateKey = String(config.push.vapidPrivateKey || '').trim();
    const vapidSubject = String(config.push.vapidSubject || '').trim();

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      this.logger.warn('Web Push disabled: set push.vapidPublicKey, push.vapidPrivateKey and push.vapidSubject in backend config.');
      return false;
    }

    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    this.logger.log('Web Push enabled');
    return true;
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

  private async sendToSubscription(subscription: PushSubscriptionPayload, payload: Record<string, unknown>) {
    try {
      await webPush.sendNotification(subscription as any, JSON.stringify(payload), {
        TTL: 120,
        urgency: 'normal',
      });
      return 0;
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        return statusCode;
      }

      this.logger.warn(`Web Push send failed: ${statusCode || 'unknown_status'} ${error?.message || ''}`.trim());
      return statusCode || -1;
    }
  }
}
