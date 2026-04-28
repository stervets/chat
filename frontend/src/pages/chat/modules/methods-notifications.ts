import type {
  Message,
  User,
  DirectDialog,
  NotificationItem,
  ToastItem,
} from './shared';
export const chatMethodsNotifications = {
    getNotificationDialogTitle(this: any, notification: NotificationItem) {
      if (notification.roomKind === 'group') {
        const notificationRoomId = Number(notification.roomId || 0);
        const fromJoined = Array.isArray(this.joinedRooms)
          ? this.joinedRooms.find((dialog: any) => Number(dialog?.id || 0) === notificationRoomId)
          : null;
        const fromPublic = Array.isArray(this.publicRooms)
          ? this.publicRooms.find((dialog: any) => Number(dialog?.id || 0) === notificationRoomId)
          : null;
        const title = String(
          fromJoined?.title
          || fromPublic?.title
          || this.generalDialog?.title
          || 'Комната'
        ).trim();
        return title || 'Комната';
      }
      if (notification.roomKind === 'comment') return 'Комментарии';
      if (notification.targetUser) return `Директ: ${notification.targetUser.name}`;
      return 'Чат';
    },

    getNotificationBodyPreview(this: any, notification: NotificationItem) {
      const normalized = String(notification.body || '').replace(/\s+/g, ' ').trim();
      if (!normalized) return '(пусто)';
      if (notification.notificationType === 'reaction') {
        return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
      }
      return normalized.length > 110 ? `${normalized.slice(0, 107)}...` : normalized;
    },

    applyFaviconHref(this: any, href: string) {
      if (typeof document === 'undefined') return;

      const links = Array.from(
        document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')
      ) as HTMLLinkElement[];

      if (!links.length) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = href;
        document.head.appendChild(link);
        return;
      }

      links.forEach((link) => {
        link.href = href;
      });
    },

    startFaviconBlink(this: any) {
      if (typeof window === 'undefined') return;
      if (this.faviconBlinkTimer) return;

      this.faviconBlinkAlertFrame = false;
      this.applyFaviconHref('/favicon.png');
      this.faviconBlinkTimer = window.setInterval(() => {
        this.faviconBlinkAlertFrame = !this.faviconBlinkAlertFrame;
        this.applyFaviconHref(this.faviconBlinkAlertFrame ? '/favicon-alert.png' : '/favicon.png');
      }, 680);
    },

    stopFaviconBlink(this: any) {
      if (this.faviconBlinkTimer) {
        clearInterval(this.faviconBlinkTimer);
        this.faviconBlinkTimer = null;
      }
      this.faviconBlinkAlertFrame = false;
      this.applyFaviconHref('/favicon.png');
    },

    updateFaviconBlinkByUnread(this: any) {
      const unreadCount = Number(this.unreadNotificationsCount || 0);
      const isDocumentVisible = this.documentVisible !== false;

      // Защита от "залипания" блинка без реальных unread в видимой вкладке.
      if (unreadCount <= 0 && isDocumentVisible && this.inactiveTabUnread) {
        this.inactiveTabUnread = false;
      }

      if (unreadCount > 0 || this.inactiveTabUnread) {
        this.startFaviconBlink();
        return;
      }
      this.stopFaviconBlink();
    },

    clearInactiveTabUnread(this: any) {
      if (!this.inactiveTabUnread) return;
      this.inactiveTabUnread = false;
      this.updateFaviconBlinkByUnread();
    },

    isWindowInactive(this: any) {
      return !this.windowFocused || !this.documentVisible;
    },

    pushToast(this: any, title: string, body: string, notificationId?: number) {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      this.toasts = [{id, title, body, notificationId}, ...this.toasts].slice(0, 4);

      const timerId = window.setTimeout(() => {
        this.removeToast(id);
      }, 4200);
      this.toastTimerById = {
        ...this.toastTimerById,
        [id]: timerId,
      };
    },

    removeToast(this: any, id: number) {
      this.toasts = this.toasts.filter((toast: ToastItem) => toast.id !== id);
      const timerId = this.toastTimerById[id];
      if (!timerId) return;
      clearTimeout(timerId);
      const next = {...this.toastTimerById};
      delete next[id];
      this.toastTimerById = next;
    },

    isToastClickable(this: any, toast: ToastItem) {
      const notificationId = Number(toast?.notificationId || 0);
      return Number.isFinite(notificationId) && notificationId > 0;
    },

    async onToastClick(this: any, toast: ToastItem) {
      if (!this.isToastClickable(toast)) return;

      const notificationId = Number(toast.notificationId || 0);
      const notification = this.notifications.find((item: NotificationItem) => item.id === notificationId);
      if (!notification) {
        this.removeToast(toast.id);
        return;
      }

      await this.openNotification(notification);
      this.removeToast(toast.id);
    },

    resolveRoomKind(this: any, roomId: number): 'group' | 'direct' | 'comment' | 'unknown' {
      if (!Number.isFinite(roomId) || roomId <= 0) return 'unknown';

      const activeDialogId = Number(this.activeDialog?.id || 0);
      if (activeDialogId > 0 && activeDialogId === roomId) {
        if (this.activeDialog?.kind === 'comment') return 'comment';
        if (this.activeDialog?.kind === 'group') return 'group';
        if (this.activeDialog?.kind === 'direct') return 'direct';
      }

      const generalId = Number(this.generalDialog?.id || 0);
      if (generalId > 0 && roomId === generalId) return 'group';

      const inJoinedGroups = Array.isArray(this.joinedRooms)
        && this.joinedRooms.some((dialog: any) => Number(dialog?.id || 0) === roomId);
      if (inJoinedGroups) return 'group';

      const inPublicGroups = Array.isArray(this.publicRooms)
        && this.publicRooms.some((dialog: any) => Number(dialog?.id || 0) === roomId);
      if (inPublicGroups) return 'group';

      const inDirects = Array.isArray(this.directDialogs)
        && this.directDialogs.some((dialog: any) => Number(dialog?.roomId || 0) === roomId);
      if (inDirects) return 'direct';

      return 'direct';
    },

    isMessageAddressedToMe(this: any, message: Message) {
      if (!message || message.authorId === this.me?.id) return false;
      const roomKind = this.resolveRoomKind(Number(message.roomId || 0));
      if (roomKind === 'direct') return true;
      return this.isMentionedForMe(message);
    },

    hasMessageNotification(this: any, messageIdRaw: unknown) {
      const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
      if (!Number.isFinite(messageId) || messageId <= 0) return false;
      return this.notifications.some((notification: NotificationItem) => {
        return notification.notificationType === 'message'
          && Number(notification.targetMessageId) === messageId;
      });
    },

    isMessageNotificationHandled(this: any, messageIdRaw: unknown) {
      const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
      if (!Number.isFinite(messageId) || messageId <= 0) return false;
      return !!this.handledMessageNotificationIds[messageId];
    },

    markMessageNotificationHandled(this: any, messageIdRaw: unknown) {
      const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      if (this.handledMessageNotificationIds[messageId]) return;
      this.handledMessageNotificationIds = {
        ...this.handledMessageNotificationIds,
        [messageId]: true,
      };
      this.scheduleHandledMessageNotificationIdsSave();
    },

    pushNotification(this: any, notification: NotificationItem, showToast: boolean) {
      this.notifications = [notification, ...this.notifications].slice(0, 500);
      this.showBrowserNotification(notification);
      if (showToast) {
        this.pushToast(
          this.getNotificationDialogTitle(notification),
          `${notification.authorName}: ${this.getNotificationBodyPreview(notification)}`,
          notification.id
        );
        void this.playNotificationSound();
      }
      this.updateFaviconBlinkByUnread();
    },

    addNotificationFromMessage(this: any, messageRaw: Message, optionsRaw?: {showToast?: boolean}) {
      const message = this.normalizeMessage(messageRaw);
      if (!this.isMessageAddressedToMe(message)) return;
      if (this.isMessageNotificationHandled(message.id)) return;
      if (this.hasMessageNotification(message.id)) return;

      const notificationId = this.notificationsSeq;
      this.notificationsSeq += 1;
      const roomKind = this.resolveRoomKind(Number(message.roomId || 0));
      const showToast = !!optionsRaw?.showToast;

      const targetUser = this.me?.id === message.authorId
        ? null
        : {
          id: message.authorId,
          nickname: message.authorNickname,
          name: message.authorName,
          nicknameColor: message.authorNicknameColor,
          donationBadgeUntil: message.authorDonationBadgeUntil || null,
        } as User;

      const notification: NotificationItem = {
        id: notificationId,
        roomId: message.roomId,
        roomKind,
        notificationType: 'message',
        authorId: message.authorId,
        authorName: message.authorName,
        authorNickname: message.authorNickname,
        authorNicknameColor: message.authorNicknameColor,
        authorDonationBadgeUntil: message.authorDonationBadgeUntil || null,
        body: this.getMessageRawText(message),
        createdAt: message.createdAt,
        unread: true,
        targetUser,
        targetMessageId: message.id,
      };

      this.pushNotification(notification, showToast);
    },

    addReactionNotification(this: any, payload: any) {
      const actor = payload?.actor;
      if (!actor?.id) return;

      const roomId = Number(payload?.roomId);
      if (!Number.isFinite(roomId)) return;

      const notificationId = this.notificationsSeq;
      this.notificationsSeq += 1;

      const roomKind = this.resolveRoomKind(roomId);

      const targetUser = this.me?.id === actor.id
        ? null
        : {
          id: actor.id,
          nickname: actor.nickname,
          name: actor.name,
          nicknameColor: actor.nicknameColor || null,
          donationBadgeUntil: actor.donationBadgeUntil || null,
        } as User;

      const sourceBody = String(payload?.messageBody || '').replace(/\s+/g, ' ').trim();
      const preview = sourceBody
        ? (sourceBody.length > 80 ? `${sourceBody.slice(0, 77)}...` : sourceBody)
        : '(пусто)';
      const emoji = String(payload?.emoji || '').trim();
      const body = `реакция ${emoji} на: ${preview}`;

      const notification: NotificationItem = {
        id: notificationId,
        roomId,
        roomKind,
        notificationType: 'reaction',
        authorId: actor.id,
        authorName: actor.name,
        authorNickname: actor.nickname,
        authorNicknameColor: actor.nicknameColor || null,
        authorDonationBadgeUntil: actor.donationBadgeUntil || null,
        body,
        createdAt: String(payload?.createdAt || new Date().toISOString()),
        unread: true,
        targetUser,
        targetMessageId: Number(payload?.messageId) || undefined,
        reactionEmoji: emoji || undefined,
      };

      this.pushNotification(notification, true);
    },

    addCommentNotification(this: any, payload: any) {
      const actor = payload?.actor;
      if (!actor?.id) return;

      const roomId = Number(payload?.roomId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;

      const notificationId = this.notificationsSeq;
      this.notificationsSeq += 1;

      const sourcePreview = String(payload?.sourceMessagePreview || '').trim();
      const messageBody = String(payload?.messageBody || '').replace(/\s+/g, ' ').trim();
      const body = sourcePreview
        ? `комментарий к: ${sourcePreview}${messageBody ? ` — ${messageBody}` : ''}`
        : (messageBody || 'Новый комментарий');

      const notification: NotificationItem = {
        id: notificationId,
        roomId,
        roomKind: 'comment',
        notificationType: 'comment',
        authorId: Number(actor.id || 0),
        authorName: String(actor.name || actor.nickname || 'Пользователь'),
        authorNickname: String(actor.nickname || ''),
        authorNicknameColor: actor.nicknameColor ? String(actor.nicknameColor) : null,
        authorDonationBadgeUntil: actor.donationBadgeUntil ? String(actor.donationBadgeUntil) : null,
        body,
        createdAt: String(payload?.createdAt || new Date().toISOString()),
        unread: true,
        targetUser: null,
        targetMessageId: Number(payload?.messageId || 0) || undefined,
      };

      this.pushNotification(notification, true);
    },

    markNotificationRead(this: any, notificationIdRaw: unknown) {
      const notificationId = Number.parseInt(String(notificationIdRaw ?? ''), 10);
      if (!Number.isFinite(notificationId) || notificationId <= 0) return;

      const target = this.notifications.find((notification: NotificationItem) => notification.id === notificationId);
      if (target?.notificationType === 'message' && target.targetMessageId) {
        this.markMessageNotificationHandled(target.targetMessageId);
      }

      const before = this.notifications.length;
      this.notifications = this.notifications.filter((notification: NotificationItem) => {
        return notification.id !== notificationId;
      });
      const changed = this.notifications.length !== before;
      if (!changed) return;
      this.updateFaviconBlinkByUnread();
    },

    markVisibleMessageNotificationsRead(this: any) {
      if (!this.messagesEl || !this.activeDialog) return;

      const viewportRect = this.messagesEl.getBoundingClientRect();
      if (viewportRect.height <= 0) return;

      const before = this.notifications.length;
      this.notifications = this.notifications.filter((notification: NotificationItem) => {
        if (notification.notificationType !== 'message') return true;
        if (notification.roomId !== this.activeDialog.id) return true;

        const targetMessageId = Number(notification.targetMessageId || 0);
        if (!Number.isFinite(targetMessageId) || targetMessageId <= 0) return true;

        const messageEl = this.messagesEl.querySelector(
          `[data-message-id="${targetMessageId}"]`
        ) as HTMLElement | null;
        if (!messageEl) return true;

        const messageRect = messageEl.getBoundingClientRect();
        const overlapTop = Math.max(viewportRect.top, messageRect.top);
        const overlapBottom = Math.min(viewportRect.bottom, messageRect.bottom);
        const visibleHeight = overlapBottom - overlapTop;
        const minVisible = Math.min(30, Math.max(10, messageRect.height * 0.35));
        if (visibleHeight < minVisible) return true;

        this.markMessageNotificationHandled(targetMessageId);
        return false;
      });
      const changed = this.notifications.length !== before;
      if (!changed) return;
      this.updateFaviconBlinkByUnread();
    },

    seedNotificationsFromMessages(this: any, messagesRaw: Message[]) {
      for (const message of messagesRaw) {
        this.addNotificationFromMessage(message, {showToast: false});
      }
    },

    toggleNotificationsMenu(this: any) {
      this.hapticTap();
      this.notificationsMenuOpen = !this.notificationsMenuOpen;
      if (this.notificationsMenuOpen) {
        this.rightMenuOpen = false;
        this.leftMenuOpen = false;
      }
    },

    clearNotifications(this: any) {
      this.hapticTap();
      this.notifications.forEach((notification: NotificationItem) => {
        if (notification.notificationType === 'message' && notification.targetMessageId) {
          this.markMessageNotificationHandled(notification.targetMessageId);
        }
      });
      this.notifications = [];
      this.inactiveTabUnread = false;
      this.updateFaviconBlinkByUnread();
    },

    closeNotificationsMenu(this: any) {
      this.notificationsMenuOpen = false;
    },

    onWindowClick(this: any, event: MouseEvent) {
      if (this.soundEnabled && !this.soundReady && !this.soundOverlayVisible) {
        this.markSoundReady();
      }

      const target = event.target as Node | null;
      if (!target) return;

      const targetEl = target instanceof HTMLElement ? target : target.parentElement;
      const inReactionControls = !!targetEl?.closest('.reaction-controls');
      if (!inReactionControls) {
        this.reactionPickerMessageId = null;
        this.reactionTooltipVisible = false;
      }

      const inComposerTools = !!targetEl?.closest('.composer-tools');
      if (!inComposerTools) {
        this.composerToolsOpen = false;
      }

      if (this.leftMenuOpen) {
        const inLeftMenu = !!targetEl?.closest('.drawer-left');
        const inMenuToggle = !!targetEl?.closest('.menu-toggle-btn');
        if (!inLeftMenu && !inMenuToggle) {
          this.closeLeftMenu();
        }
      }

      if (!this.notificationsMenuOpen) return;

      const inMenu = this.notificationMenuEl?.contains(target);
      const inButton = this.notificationButtonEl?.contains(target);
      if (inMenu || inButton) return;

      this.closeNotificationsMenu();
    },

    async ensureMessageLoadedById(this: any, messageIdRaw: unknown) {
      const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
      if (!Number.isFinite(messageId) || messageId <= 0) return false;
      if (this.messages.some((message: Message) => Number(message.id) === messageId)) {
        return true;
      }

      let guard = 0;
      while (this.historyHasMore && guard < 80) {
        const beforeLen = this.messages.length;
        await this.loadOlderHistory();
        guard += 1;

        if (this.messages.some((message: Message) => Number(message.id) === messageId)) {
          return true;
        }
        if (this.messages.length <= beforeLen) break;
      }

      return this.messages.some((message: Message) => Number(message.id) === messageId);
    },

    async openNotification(this: any, notification: NotificationItem) {
      this.hapticTap();
      const targetMessageId = Number(notification.targetMessageId || 0) || null;
      if (notification.notificationType === 'reaction' || !targetMessageId) {
        this.markNotificationRead(notification.id);
      }

      let targetDialog = null;
      if (notification.roomKind === 'group' && this.generalDialog) {
        targetDialog = this.generalDialog;
      } else {
        const fromRoom = this.buildDialogFromRoomRoute(notification.roomId);
        if (fromRoom) {
          targetDialog = fromRoom;
        } else {
          const direct = this.directDialogs.find((dialog: DirectDialog) => dialog.roomId === notification.roomId);
          if (direct) {
            targetDialog = {
              id: direct.roomId,
              kind: 'direct',
              joined: true,
              targetUser: direct.targetUser,
              title: direct.targetUser.name,
            };
          } else if (notification.targetUser && notification.roomKind === 'direct') {
            await this.selectPrivate(notification.targetUser);
            targetDialog = this.activeDialog;
          }
        }
      }

      if (targetDialog && this.activeDialog?.id !== Number(targetDialog.id || 0)) {
        await this.selectDialog(targetDialog);
      }

      if (targetMessageId) {
        const loaded = await this.ensureMessageLoadedById(targetMessageId);
        if (loaded) {
          const jumped = await this.scrollToMessageById(targetMessageId);
          if (jumped) {
            this.markNotificationRead(notification.id);
            window.setTimeout(() => this.markVisibleMessageNotificationsRead(), 280);
            window.setTimeout(() => this.markVisibleMessageNotificationsRead(), 640);
          }
        }
      }
      this.closeNotificationsMenu();
    },
};
