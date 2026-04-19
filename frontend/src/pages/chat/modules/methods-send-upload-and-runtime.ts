import {
  nextTick,
  ws,
  getApiBase,
  getSessionToken,
  wsLogout,
  HISTORY_BATCH_SIZE,
  MAX_PASTE_IMAGE_BYTES,
} from './shared';
import type {
  Message,
  DirectDialog,
  NotificationItem,
} from './shared';

const WS_LOST_ERROR_PREFIX = 'Соединение потеряно.';
const WS_RECONNECT_SEND_ERROR = 'Подключение восстанавливается. Сообщение не отправлено.';
const WS_OFFLINE_SEND_ERROR = 'Оффлайн. Сообщение не отправлено.';

function isTransientConnectionError(errorRaw: unknown) {
  const error = String(errorRaw || '').trim();
  if (!error) return false;
  if (error === WS_RECONNECT_SEND_ERROR) return true;
  if (error === WS_OFFLINE_SEND_ERROR) return true;
  return error.startsWith(WS_LOST_ERROR_PREFIX);
}

export const chatMethodsSendUploadAndRuntime = {
    isFreshMessage(this: any, messageIdRaw: unknown) {
      const messageId = Number(messageIdRaw || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return false;
      return !!this.freshMessageIds?.[messageId];
    },

    clearFreshMessageMarks(this: any) {
      if (typeof window !== 'undefined') {
        Object.values(this.freshMessageTimers as Record<number, number>).forEach((timerId) => {
          clearTimeout(Number(timerId));
        });
      }
      this.freshMessageTimers = {};
      this.freshMessageIds = {};
    },

    markFreshMessage(this: any, messageIdRaw: unknown) {
      const messageId = Number(messageIdRaw || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;

      if (typeof window === 'undefined') {
        this.freshMessageIds = {
          ...this.freshMessageIds,
          [messageId]: true,
        };
        return;
      }

      const existingTimer = Number(this.freshMessageTimers?.[messageId] || 0);
      if (existingTimer > 0) {
        clearTimeout(existingTimer);
      }

      this.freshMessageIds = {
        ...this.freshMessageIds,
        [messageId]: true,
      };

      const timeoutId = window.setTimeout(() => {
        const nextIds = {...(this.freshMessageIds || {})};
        delete nextIds[messageId];
        this.freshMessageIds = nextIds;

        const nextTimers = {...(this.freshMessageTimers || {})};
        delete nextTimers[messageId];
        this.freshMessageTimers = nextTimers;
      }, 520);

      this.freshMessageTimers = {
        ...this.freshMessageTimers,
        [messageId]: timeoutId,
      };
    },

    async catchUpDialogMessages(this: any, dialogIdRaw: unknown) {
      const dialogId = Number(dialogIdRaw || 0);
      if (!Number.isFinite(dialogId) || dialogId <= 0) return false;
      if (this.wsConnectionState !== 'connected') return false;

      const result = await ws.request('dialogs:messages', dialogId, HISTORY_BATCH_SIZE);
      if (!Array.isArray(result)) return false;

      const incoming = result
        .map((row: any) => this.normalizeMessage(row))
        .filter((message: Message) => Number(message.dialogId || 0) === dialogId);
      if (!incoming.length) return true;

      const currentMessages = Array.isArray(this.messages) ? this.messages : [];
      const currentById = new Map<number, Message>();
      currentMessages.forEach((message: Message) => {
        const id = Number(message?.id || 0);
        if (!Number.isFinite(id) || id <= 0) return;
        currentById.set(id, message);
      });

      let changed = false;
      incoming.forEach((message: Message) => {
        const id = Number(message?.id || 0);
        if (!Number.isFinite(id) || id <= 0) return;

        const prev = currentById.get(id);
        if (!prev) {
          currentById.set(id, message);
          changed = true;
          return;
        }

        const prevReactionsCount = Array.isArray(prev.reactions) ? prev.reactions.length : 0;
        const nextReactionsCount = Array.isArray(message.reactions) ? message.reactions.length : 0;
        const shouldReplace = prev.rawText !== message.rawText
          || prev.renderedHtml !== message.renderedHtml
          || String(prev.createdAt || '') !== String(message.createdAt || '')
          || prevReactionsCount !== nextReactionsCount;

        if (shouldReplace) {
          currentById.set(id, {
            ...prev,
            ...message,
          });
          changed = true;
        }
      });

      if (!changed) return true;

      const wasNearBottom = this.isNearBottom();
      const prevScrollTop = Number(this.messagesEl?.scrollTop || 0);

      const merged = Array.from(currentById.values()).sort((left: Message, right: Message) => {
        const leftTs = Date.parse(String(left.createdAt || ''));
        const rightTs = Date.parse(String(right.createdAt || ''));
        const leftTime = Number.isFinite(leftTs) ? leftTs : 0;
        const rightTime = Number.isFinite(rightTs) ? rightTs : 0;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return Number(left.id || 0) - Number(right.id || 0);
      });

      this.messages = merged;
      this.notifyMessagesChanged();
      await nextTick();

      if (wasNearBottom) {
        this.scrollToBottomPinned('auto');
      } else if (this.messagesEl) {
        this.messagesEl.scrollTop = prevScrollTop;
        this.scheduleVirtualSync();
      }
      this.updateScrollDownVisibility();
      return true;
    },

    normalizeUploadFileName(this: any, mimeRaw: string) {
      const mime = String(mimeRaw || '').toLowerCase();
      if (mime.includes('png')) return `paste-${Date.now()}.png`;
      if (mime.includes('webp')) return `paste-${Date.now()}.webp`;
      if (mime.includes('gif')) return `paste-${Date.now()}.gif`;
      return `paste-${Date.now()}.jpg`;
    },

    canvasToBlob(this: any, canvas: HTMLCanvasElement, mime: string, quality: number) {
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mime, quality);
      });
    },

    loadImageFromBlob(this: any, blob: Blob) {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        const src = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(src);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(src);
          reject(new Error('image_decode_failed'));
        };
        img.src = src;
      });
    },

    async compressImageToLimit(this: any, source: Blob, maxBytes: number) {
      if (source.type === 'image/gif') {
        return source;
      }

      if (source.size <= maxBytes) {
        return source;
      }

      const image = await this.loadImageFromBlob(source);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return source;

      let scale = 1;
      let quality = 0.9;
      let bestBlob: Blob = source;

      for (let attempt = 0; attempt < 14; attempt += 1) {
        const width = Math.max(1, Math.floor(image.naturalWidth * scale));
        const height = Math.max(1, Math.floor(image.naturalHeight * scale));
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

        const mime = source.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const blob = await this.canvasToBlob(canvas, mime, quality);
        if (!blob) break;

        if (blob.size < bestBlob.size) {
          bestBlob = blob;
        }
        if (blob.size <= maxBytes) {
          return blob;
        }

        if (quality > 0.46) {
          quality = Math.max(0.46, quality - 0.12);
          continue;
        }
        scale *= 0.84;
        quality = 0.84;
      }

      return bestBlob;
    },

    async preparePastedImage(this: any, file: File) {
      const compressed = await this.compressImageToLimit(file, MAX_PASTE_IMAGE_BYTES);
      if (compressed.size > MAX_PASTE_IMAGE_BYTES) {
        return null;
      }
      const mime = compressed.type || 'image/jpeg';
      const fileName = this.normalizeUploadFileName(mime);
      return new File([compressed], fileName, {type: mime});
    },

    async uploadImageFile(this: any, file: File) {
      const token = getSessionToken();
      if (!token) {
        return {ok: false, error: 'unauthorized'};
      }

      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${getApiBase()}/upload/image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      let result: any = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok) {
        return {
          ok: false,
          error: result?.message || result?.error || 'upload_failed',
        };
      }

      return result;
    },

    async sendMessageBody(this: any, textRaw: string) {
      if (!this.activeDialog) return false;
      if (this.wsConnectionState !== 'connected') {
        this.error = this.wsConnectionState === 'connecting'
          ? WS_RECONNECT_SEND_ERROR
          : WS_OFFLINE_SEND_ERROR;
        return false;
      }
      if (isTransientConnectionError(this.error)) {
        this.error = '';
      }

      const text = String(textRaw || '').trim();
      if (!text) return false;

      const result = await ws.request('chat:send', this.activeDialog.id, text);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось отправить сообщение.';
        return false;
      }

      this.hapticConfirm();
      this.forceOwnScrollDown = true;
      this.scrollToBottomPinned();
      if (this.activeDialog.kind === 'private') {
        await this.fetchDirectDialogs();
      }
      return true;
    },

    async onSend(this: any) {
      const text = this.messageText.trim();
      if (!text) return;
      const ok = await this.sendMessageBody(text);
      if (ok) {
        this.messageText = '';
        this.composerSelectionStart = 0;
        this.composerSelectionEnd = 0;
        this.captureInputSelection();
      }
    },

    async onInputPaste(this: any, event: ClipboardEvent) {
      if (!event.clipboardData) return;

      const files = Array.from(event.clipboardData.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[];

      if (!files.length) return;

      event.preventDefault();
      await this.attachImageFiles(files);
    },

    onKeydown(this: any, event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      void this.onSend();
    },

    async onLogout(this: any) {
      this.hapticTap();
      this.error = '';
      await wsLogout();
      await this.router.push('/login');
    },

    isNearBottom(this: any, thresholdRaw?: unknown) {
      if (!this.messagesEl) return true;
      const threshold = Number.isFinite(Number(thresholdRaw))
        ? Math.max(0, Number(thresholdRaw))
        : 50;
      const distance = this.messagesEl.scrollHeight - (this.messagesEl.scrollTop + this.messagesEl.clientHeight);
      return distance <= threshold;
    },

    updateScrollDownVisibility(this: any) {
      if (!this.messagesEl || !this.messages.length) {
        this.showScrollDown = false;
        return;
      }
      this.showScrollDown = !this.isNearBottom();
    },

    onMessagesScroll(this: any) {
      this.syncVirtualWindowFromScroll();
      this.updateScrollDownVisibility();
      this.markVisibleMessageNotificationsRead();
      if (!this.messagesEl) return;
      if (this.messagesEl.scrollTop > 80) return;
      void this.loadOlderHistory();
    },

    onScrollDownClick(this: any) {
      this.hapticTap();
      this.scrollToBottomPinned('smooth');
    },

    scrollToBottom(this: any, behavior: ScrollBehavior = 'auto') {
      if (!this.messagesEl) return;
      this.messagesEl.scrollTo({
        top: this.messagesEl.scrollHeight,
        behavior,
      });
      this.showScrollDown = false;
      this.scheduleVirtualSync();
    },

    scrollToBottomPinned(this: any, behavior: ScrollBehavior = 'auto') {
      this.scrollToBottom(behavior);
      if (typeof window === 'undefined') return;

      window.requestAnimationFrame(() => {
        this.scrollToBottom(behavior === 'smooth' ? 'smooth' : 'auto');
      });
      window.setTimeout(() => {
        if (this.isNearBottom(60)) return;
        this.scrollToBottom('auto');
      }, 120);
    },

    async onChatMessage(this: any, message: Message) {
      const normalized = this.normalizeMessage(message);
      if (this.messages.some((item: Message) => Number(item.id) === Number(normalized.id))) {
        this.applyMessageUpdate(normalized);
        return;
      }

      const ownMessage = normalized.authorId === this.me?.id;
      const isCurrentDialogMessage = this.activeDialog?.id === normalized.dialogId;
      const addressedToMe = this.isMessageAddressedToMe(normalized);

      if (!isCurrentDialogMessage) {
        if (!ownMessage) {
          this.addNotificationFromMessage(normalized, {showToast: true});
        }
        await this.fetchDirectDialogs();
        return;
      }

      if (!ownMessage && addressedToMe && this.isWindowInactive()) {
        this.inactiveTabUnread = true;
        this.updateFaviconBlinkByUnread();
      }

      const shouldAutoScroll = this.isNearBottom() || (ownMessage && this.forceOwnScrollDown);
      this.markFreshMessage(normalized.id);
      this.messages.push(normalized);
      this.notifyMessagesChanged();
      await nextTick();
      if (shouldAutoScroll) {
        this.scrollToBottomPinned();
      } else {
        this.updateScrollDownVisibility();
      }

      if (!ownMessage && addressedToMe) {
        const isActuallyVisible = shouldAutoScroll && !this.isWindowInactive();
        if (!isActuallyVisible) {
          this.addNotificationFromMessage(normalized, {showToast: true});
        }
      }
      this.markVisibleMessageNotificationsRead();

      if (ownMessage) {
        this.forceOwnScrollDown = false;
      }
      if (this.activeDialog.kind === 'private') {
        await this.fetchDirectDialogs();
      }
    },

    onChatMessageUpdated(this: any, messageRaw: any) {
      const message = this.normalizeMessage(messageRaw);
      if (this.activeDialog?.id !== message.dialogId) return;
      this.applyMessageUpdate(message);
    },

    async onChatMessageDeleted(this: any, payload: any) {
      const dialogId = Number(payload?.dialogId);
      const messageId = Number(payload?.messageId);
      if (!Number.isFinite(dialogId) || !Number.isFinite(messageId)) return;

      const nextFreshIds = {...(this.freshMessageIds || {})};
      delete nextFreshIds[messageId];
      this.freshMessageIds = nextFreshIds;

      if (this.activeDialog?.id === dialogId) {
        this.applyMessageDelete(dialogId, messageId);
      }
      await this.fetchDirectDialogs();
    },

    async onDialogDeleted(this: any, payload: any) {
      const dialogId = Number(payload?.dialogId);
      if (!Number.isFinite(dialogId)) return;

      this.directDialogs = this.directDialogs.filter((dialog: DirectDialog) => dialog.dialogId !== dialogId);
      this.notifications = this.notifications.filter((notification: NotificationItem) => notification.dialogId !== dialogId);
      this.notificationsMenuOpen = false;
      this.updateFaviconBlinkByUnread();

      if (this.activeDialog?.id !== dialogId) {
        await this.fetchDirectDialogs();
        return;
      }

      this.messages = [];
      this.notifyMessagesChanged();
      this.cancelMessageEdit();
      this.reactionPickerMessageId = null;
      this.reactionTooltipVisible = false;
      this.resetMessagePreviewCache();

      if (this.generalDialog) {
        await this.selectDialog(this.generalDialog, {routeMode: 'replace'});
      } else {
        this.activeDialog = null;
      }
      await this.fetchDirectDialogs();
    },

    onDisconnected(this: any) {
      if (!this.error || isTransientConnectionError(this.error)) {
        this.error = 'Соединение потеряно. Переподключаюсь...';
      }
    },

    async onWsReconnected(this: any) {
      if (isTransientConnectionError(this.error)) {
        this.error = '';
      }

      const activeDialogId = Number(this.activeDialog?.id || 0);
      if (Number.isFinite(activeDialogId) && activeDialogId > 0) {
        await this.catchUpDialogMessages(activeDialogId);
      }

      if (this.activeDialog?.kind === 'private') {
        await this.fetchDirectDialogs();
      }
      this.markVisibleMessageNotificationsRead();
    },

    async onWsSessionExpired(this: any) {
      this.error = 'Сессия истекла. Войди заново.';
      await this.router.push('/login');
    },

    onWindowKeydown(this: any, event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (this.leftMenuOpen) this.leftMenuOpen = false;
      if (this.rightMenuOpen) this.rightMenuOpen = false;
      if (this.notificationsMenuOpen) this.notificationsMenuOpen = false;
      if (this.timeTooltipVisible) this.timeTooltipVisible = false;
      if (this.reactionTooltipVisible) this.reactionTooltipVisible = false;
      if (this.reactionPickerMessageId) this.reactionPickerMessageId = null;
      if (this.editingMessageId) this.cancelMessageEdit();
    },

    initLayout(this: any) {
      if (typeof window === 'undefined') return;
      this.isCompactLayout = window.innerWidth < 1100;
      this.leftMenuOpen = false;
      this.rightMenuOpen = false;
    },

    onWindowResize(this: any) {
      const nextCompact = window.innerWidth < 1100;
      if (nextCompact === this.isCompactLayout) {
        this.scheduleVirtualSync();
        return;
      }
      this.isCompactLayout = nextCompact;
      if (nextCompact) {
        this.leftMenuOpen = false;
        this.rightMenuOpen = false;
        this.scheduleVirtualSync();
        return;
      }

      this.leftMenuOpen = false;
      this.rightMenuOpen = false;
      this.scheduleVirtualSync();
    },

    onWindowFocus(this: any) {
      this.windowFocused = true;
      if (this.documentVisible) {
        this.clearInactiveTabUnread();
        this.markVisibleMessageNotificationsRead();
      }
    },

    onWindowBlur(this: any) {
      this.windowFocused = false;
    },

    onVisibilityChange(this: any) {
      this.documentVisible = !document.hidden;
      if (this.documentVisible && this.windowFocused) {
        this.clearInactiveTabUnread();
        this.markVisibleMessageNotificationsRead();
      }
    },
};
