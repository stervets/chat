import {
  nextTick,
  ws,
  wsData,
  wsObject,
  getApiBase,
  getSessionToken,
  wsLogout,
  HISTORY_BATCH_SIZE,
  MAX_PASTE_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_DIMENSION,
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

    async catchUpRoomMessages(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return false;
      if (this.wsConnectionState !== 'connected') return false;

      const result = await ws.request('message:list', {
        roomId,
        limit: HISTORY_BATCH_SIZE,
      });
      if (!(result as any)?.ok) return false;
      const rows = wsData<any[]>(result, []);

      const incoming = rows
        .map((row: any) => this.normalizeMessage(row))
        .filter((message: Message) => Number(message.roomId || 0) === roomId);
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
        if (source.size <= maxBytes) return source;
        return null;
      }

      const image = await this.loadImageFromBlob(source);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return source;

      const maxSide = Math.max(1, Number(MAX_UPLOAD_IMAGE_DIMENSION || 1024));
      const sourceMaxSide = Math.max(1, image.naturalWidth, image.naturalHeight);
      const baseScale = Math.min(1, maxSide / sourceMaxSide);
      const baseWidth = Math.max(1, Math.floor(image.naturalWidth * baseScale));
      const baseHeight = Math.max(1, Math.floor(image.naturalHeight * baseScale));

      let scale = 1;
      let quality = 0.9;
      let bestBlob: Blob | null = null;

      for (let attempt = 0; attempt < 14; attempt += 1) {
        const width = Math.max(1, Math.floor(baseWidth * scale));
        const height = Math.max(1, Math.floor(baseHeight * scale));
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

        const preferredMime = source.type === 'image/png' ? 'image/png' : 'image/jpeg';
        let blob = await this.canvasToBlob(canvas, preferredMime, quality);
        if (!blob) break;

        if (blob.size > maxBytes && preferredMime === 'image/png') {
          const jpegBlob = await this.canvasToBlob(canvas, 'image/jpeg', quality);
          if (jpegBlob && jpegBlob.size <= blob.size) {
            blob = jpegBlob;
          }
        }

        if (!bestBlob || blob.size < bestBlob.size) {
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

    async prepareUploadMediaFile(this: any, file: File) {
      if (!String(file?.type || '').startsWith('image/')) {
        return file;
      }

      const compressed = await this.compressImageToLimit(file, MAX_PASTE_IMAGE_BYTES);
      if (!compressed || compressed.size > MAX_PASTE_IMAGE_BYTES) {
        return null;
      }
      const mime = compressed.type || 'image/jpeg';
      const fileName = this.normalizeUploadFileName(mime);
      return new File([compressed], fileName, {type: mime});
    },

    async uploadMediaFile(this: any, file: File) {
      const token = getSessionToken();
      if (!token) {
        return {ok: false, error: 'unauthorized'};
      }

      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${getApiBase()}/upload/media`, {
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
      const anonymous = !!this.sendAnonymous;
      const pendingRoomId = Number(this.activeDialog.id || 0);
      const pendingCreatedAt = Date.now();

      if (anonymous) {
        this.pendingAnonymousOwnMessage = {
          roomId: pendingRoomId,
          messageId: 0,
          rawText: text,
          createdAt: pendingCreatedAt,
        };
      } else {
        this.pendingAnonymousOwnMessage = null;
      }

      const result = await ws.request('message:create', {
        roomId: this.activeDialog.id,
        kind: 'text',
        text,
        anonymous,
      });
      if (!(result as any)?.ok) {
        if (anonymous) {
          const candidate = this.pendingAnonymousOwnMessage;
          if (
            candidate
            && Number(candidate.roomId || 0) === pendingRoomId
            && Number(candidate.createdAt || 0) === pendingCreatedAt
          ) {
            this.pendingAnonymousOwnMessage = null;
          }
        }
        const errorCode = String((result as any)?.error || '');
        this.error = errorCode === 'room_posting_restricted'
          ? 'Канал: писать может админ.'
          : 'Не удалось отправить сообщение.';
        return false;
      }
      const createdMessageId = Number(wsObject(result).message?.id || 0);

      if (anonymous) {
        const candidate = this.pendingAnonymousOwnMessage;
        if (
          candidate
          && Number(candidate.roomId || 0) === pendingRoomId
          && Number(candidate.createdAt || 0) === pendingCreatedAt
        ) {
          this.pendingAnonymousOwnMessage = {
            ...candidate,
            messageId: Number.isFinite(createdMessageId) ? createdMessageId : 0,
          };
        }
      }

      this.hapticConfirm();
      this.forceOwnScrollDown = true;
      this.scrollToBottomPinned();
      if (this.activeDialog.kind === 'direct') {
        await this.fetchDirectDialogs();
      }
      return true;
    },

    async onSend(this: any) {
      if (!this.canComposeInActiveDialog) return;
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
      await this.attachMediaFiles(files);
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
      this.emitScriptHostRoomEvent('chat_message', {
        id: normalized.id,
        roomId: normalized.roomId,
        kind: normalized.kind,
        authorId: normalized.authorId,
        authorNickname: normalized.authorNickname,
      }, 'room', normalized.roomId);

      if (this.messages.some((item: Message) => Number(item.id) === Number(normalized.id))) {
        this.applyMessageUpdate(normalized);
        return;
      }

      const ownByAuthor = normalized.authorId === this.me?.id;
      const ownByAnonymousEcho = this.consumeAnonymousOwnMessageCandidate(normalized);
      const ownMessage = ownByAuthor || ownByAnonymousEcho;
      const isCurrentDialogMessage = this.activeDialog?.id === normalized.roomId;
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
      if (this.activeDialog.kind === 'direct') {
        await this.fetchDirectDialogs();
      }
    },

    onChatMessageUpdated(this: any, messageRaw: any) {
      const message = this.normalizeMessage(messageRaw);
      this.emitScriptHostRoomEvent('chat_message_updated', {
        id: message.id,
        roomId: message.roomId,
      }, 'room', message.roomId);
      if (Number(this.activePinnedMessage?.id || 0) === Number(message.id || 0)) {
        this.activePinnedMessage = message;
      }
      if (this.activeDialog?.id !== message.roomId) return;
      this.applyMessageUpdate(message);
    },

    async onChatMessageDeleted(this: any, payload: any) {
      const roomId = Number(payload?.roomId);
      const messageId = Number(payload?.messageId);
      if (!Number.isFinite(roomId) || !Number.isFinite(messageId)) return;

      const nextFreshIds = {...(this.freshMessageIds || {})};
      delete nextFreshIds[messageId];
      this.freshMessageIds = nextFreshIds;

      if (this.activeDialog?.id === roomId) {
        this.applyMessageDelete(roomId, messageId);
      }
      this.emitScriptHostRoomEvent('chat_message_deleted', {
        roomId,
        messageId,
      }, 'room', roomId);
      await this.fetchDirectDialogs();
    },

    async onRoomMessagesCleared(this: any, payload: any) {
      const roomId = Number(payload?.roomId || payload?.dialogId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;

      const kind = String(payload?.kind || '').trim().toLowerCase();
      if (kind && kind !== 'direct') return;

      this.notifications = this.notifications.filter((notification: NotificationItem) => notification.roomId !== roomId);
      this.notificationsMenuOpen = false;
      this.updateFaviconBlinkByUnread();

      if (Number(this.activeDialog?.id || 0) !== roomId) {
        await this.fetchDirectDialogs();
        await this.fetchPinnedDirectUserIds();
        return;
      }

      this.historyLoadSeq = Number(this.historyLoadSeq || 0) + 1;
      this.messages = [];
      this.activePinnedMessage = null;
      this.notifyMessagesChanged();
      this.cancelMessageEdit();
      this.reactionPickerMessageId = null;
      this.reactionTooltipVisible = false;
      this.discussionOpenPendingMessageId = null;
      this.resetMessagePreviewCache();
      this.clearFreshMessageMarks();

      await this.fetchDirectDialogs();
      await this.fetchPinnedDirectUserIds();
    },

    async onDialogDeleted(this: any, payload: any) {
      const roomId = Number(payload?.roomId);
      if (!Number.isFinite(roomId)) return;

      this.directDialogs = this.directDialogs.filter((dialog: DirectDialog) => dialog.roomId !== roomId);
      this.notifications = this.notifications.filter((notification: NotificationItem) => notification.roomId !== roomId);
      this.notificationsMenuOpen = false;
      this.updateFaviconBlinkByUnread();

      if (this.activeDialog?.id !== roomId) {
        await this.fetchDirectDialogs();
        await this.fetchPinnedDirectUserIds();
        await this.fetchRoomsNavigation();
        return;
      }

      this.messages = [];
      this.activePinnedMessage = null;
      this.notifyMessagesChanged();
      this.cancelMessageEdit();
      this.reactionPickerMessageId = null;
      this.reactionTooltipVisible = false;
      this.resetMessagePreviewCache();

      this.generalDialog = await this.fetchGeneralDialog();
      const selected = await this.selectDefaultGroupDialog({routeMode: 'replace', closeMenu: false});
      if (!selected) {
        this.activeDialog = null;
        this.setActiveRoomScript(null);
      }
      await this.fetchDirectDialogs();
      await this.fetchPinnedDirectUserIds();
      await this.fetchRoomsNavigation();
    },

    consumeAnonymousOwnMessageCandidate(this: any, message: Message) {
      const candidate = this.pendingAnonymousOwnMessage;
      if (!candidate) return false;

      const ageMs = Date.now() - Number(candidate.createdAt || 0);
      if (ageMs > 8000) {
        this.pendingAnonymousOwnMessage = null;
        return false;
      }

      const messageAuthorId = Number(message.authorId || 0);
      const messageAuthorNickname = String(message.authorNickname || '').trim().toLowerCase();
      const messageIsAnonymousAuthor = messageAuthorNickname === 'anonymous';
      const roomId = Number(message.roomId || 0);
      const candidateRoomId = Number(candidate.roomId || 0);
      if (roomId !== candidateRoomId) {
        return false;
      }
      if (messageAuthorId > 0 && !messageIsAnonymousAuthor) {
        return false;
      }

      const candidateMessageId = Number(candidate.messageId || 0);
      if (candidateMessageId > 0) {
        if (Number(message.id || 0) !== candidateMessageId) {
          return false;
        }
      } else {
        const candidateText = String(candidate.rawText || '').trim();
        const messageText = String(message.rawText || '').trim();
        if (!candidateText || !messageText) {
          return false;
        }

        const messageCreatedAtTs = Date.parse(String(message.createdAt || ''));
        const candidateCreatedAtTs = Number(candidate.createdAt || 0);
        if (Number.isFinite(messageCreatedAtTs) && Math.abs(messageCreatedAtTs - candidateCreatedAtTs) > 8000) {
          return false;
        }

        if (
          candidateText !== messageText
          && !candidateText.startsWith(messageText)
          && !messageText.startsWith(candidateText)
        ) {
          return false;
        }
      }

      this.pendingAnonymousOwnMessage = null;
      return true;
    },

    onDisconnected(this: any) {
      if (!this.error || isTransientConnectionError(this.error)) {
        this.error = 'Соединение потеряно. Переподключаюсь...';
      }
      this.emitScriptHostRoomEvent('system:ws_disconnected', {}, 'system');
    },

    async onWsReconnected(this: any) {
      if (isTransientConnectionError(this.error)) {
        this.error = '';
      }

      const activeDialogId = Number(this.activeDialog?.id || 0);
      if (Number.isFinite(activeDialogId) && activeDialogId > 0) {
        await this.joinDialog(activeDialogId);
        await this.catchUpRoomMessages(activeDialogId);
      }

      if (this.activeDialog?.kind === 'direct') {
        await this.fetchDirectDialogs();
      }
      await this.fetchPinnedDirectUserIds();
      await this.fetchRoomsNavigation();
      this.markVisibleMessageNotificationsRead();
      this.emitScriptHostRoomEvent('system:ws_reconnected', {}, 'system');
    },

    async onWsSessionExpired(this: any) {
      this.error = 'Сессия истекла. Войди заново.';
      this.emitScriptHostRoomEvent('system:session_expired', {}, 'system');
      await this.router.push('/login');
    },

    onWindowKeydown(this: any, event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (this.imageViewerVisible) {
        this.closeImageViewer();
        return;
      }
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
      if (this.wsConnectionState === 'connected') {
        void this.fetchPinnedDirectUserIds();
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
        if (this.wsConnectionState === 'connected') {
          void this.fetchPinnedDirectUserIds();
        }
      }
    },
};
