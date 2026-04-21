import {
  nextTick,
  ws,
  MENTION_TAG_RE,
  VIRTUAL_MAX_ITEMS,
  VIRTUAL_OVERSCAN,
  VIRTUAL_ESTIMATED_ITEM_HEIGHT,
  COLOR_HEX_FULL_RE,
  COMPOSER_NAMED_COLORS,
  COMPOSER_EMOJIS,
  DONATION_BADGE_FADE_MS,
} from './shared';
import type {
  Message,
  User,
  NotificationItem,
} from './shared';
export const chatMethodsComposerAndVirtual = {
    isDirectDialogUnread(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return false;
      return !!this.unreadDirectDialogIds?.[roomId];
    },

    estimateMessageHeight(this: any, message: Message) {
      const known = Number(this.virtualMessageHeights?.[message.id] || 0);
      if (known > 0) return known;
      return VIRTUAL_ESTIMATED_ITEM_HEIGHT;
    },

    rebuildVirtualPrefix(this: any) {
      if (!this.messages.length) {
        this.virtualPrefixHeights = [0];
        this.virtualTotalHeight = 0;
        return;
      }

      const prefix = new Array(this.messages.length + 1);
      prefix[0] = 0;
      for (let index = 0; index < this.messages.length; index += 1) {
        prefix[index + 1] = prefix[index] + this.estimateMessageHeight(this.messages[index]);
      }

      this.virtualPrefixHeights = prefix;
      this.virtualTotalHeight = prefix[prefix.length - 1] || 0;
    },

    findMessageIndexByOffset(this: any, offsetRaw: number) {
      const total = this.messages.length;
      if (!total) return 0;

      const prefix = this.virtualPrefixHeights;
      if (!Array.isArray(prefix) || prefix.length !== total + 1) {
        return 0;
      }

      const totalHeight = Number(this.virtualTotalHeight || 0);
      const offset = Math.max(0, Number(offsetRaw || 0));
      if (offset <= 0) return 0;
      if (offset >= totalHeight) return total - 1;

      let left = 0;
      let right = total - 1;
      while (left <= right) {
        const middle = (left + right) >> 1;
        const rowTop = Number(prefix[middle] || 0);
        const rowBottom = Number(prefix[middle + 1] || rowTop);
        if (offset < rowTop) {
          right = middle - 1;
          continue;
        }
        if (offset >= rowBottom) {
          left = middle + 1;
          continue;
        }
        return middle;
      }

      return Math.max(0, Math.min(total - 1, left));
    },

    syncVirtualWindowFromScroll(this: any) {
      const total = this.messages.length;
      if (!total) {
        this.virtualRangeStart = 0;
        this.virtualRangeEnd = 0;
        this.virtualPrefixHeights = [0];
        this.virtualTotalHeight = 0;
        return;
      }

      this.rebuildVirtualPrefix();
      if (total <= VIRTUAL_MAX_ITEMS || !this.messagesEl) {
        this.virtualRangeStart = 0;
        this.virtualRangeEnd = total;
        return;
      }

      const scrollTop = Math.max(0, Number(this.messagesEl.scrollTop || 0));
      const viewportBottom = scrollTop + Math.max(1, Number(this.messagesEl.clientHeight || 1));
      const firstVisible = this.findMessageIndexByOffset(scrollTop);
      const lastVisible = this.findMessageIndexByOffset(Math.max(0, viewportBottom - 1));

      let start = Math.max(0, firstVisible - VIRTUAL_OVERSCAN);
      let end = Math.min(total, start + VIRTUAL_MAX_ITEMS);

      const requiredEnd = Math.min(total, lastVisible + 1 + VIRTUAL_OVERSCAN);
      if (end < requiredEnd) {
        end = requiredEnd;
        start = Math.max(0, end - VIRTUAL_MAX_ITEMS);
      }

      this.virtualRangeStart = start;
      this.virtualRangeEnd = end;
    },

    scheduleVirtualSync(this: any) {
      if (this.virtualSyncScheduled) return;
      this.virtualSyncScheduled = true;

      const run = () => {
        this.virtualSyncScheduled = false;
        this.syncVirtualWindowFromScroll();
      };

      if (typeof window === 'undefined') {
        run();
        return;
      }
      window.requestAnimationFrame(run);
    },

    pruneVirtualHeightMap(this: any) {
      const current = this.virtualMessageHeights || {};
      const activeIds = new Set(this.messages.map((message: Message) => Number(message.id)));
      const next: Record<number, number> = {};

      for (const [idRaw, valueRaw] of Object.entries(current)) {
        const id = Number.parseInt(idRaw, 10);
        if (!Number.isFinite(id) || !activeIds.has(id)) continue;
        const value = Number(valueRaw || 0);
        if (value <= 0) continue;
        next[id] = value;
      }

      this.virtualMessageHeights = next;
    },

    notifyMessagesChanged(this: any) {
      this.pruneVirtualHeightMap();
      this.scheduleVirtualSync();
    },

    onVirtualItemHeight(this: any, messageIdRaw: unknown, heightRaw: unknown) {
      const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
      const height = Math.max(24, Math.round(Number(heightRaw || 0)));
      if (!Number.isFinite(messageId) || !Number.isFinite(height) || height <= 0) return;

      const prev = Number(this.virtualMessageHeights?.[messageId] || 0);
      if (prev > 0 && Math.abs(prev - height) < 2) return;

      this.virtualMessageHeights = {
        ...this.virtualMessageHeights,
        [messageId]: height,
      };
      this.scheduleVirtualSync();
    },

    normalizeColor(this: any, raw: string) {
      const value = String(raw || '').trim();
      if (!value) return '';
      return value.toLowerCase();
    },

    formatUsername(this: any, nicknameRaw: unknown) {
      const nickname = String(nicknameRaw || '').trim();
      if (!nickname) return '';
      return `@${nickname}`;
    },

    parseDonationBadgeUntilTs(this: any, raw: unknown) {
      const value = String(raw || '').trim();
      if (!value) return 0;
      const ts = Date.parse(value);
      return Number.isFinite(ts) ? ts : 0;
    },

    getDonationBadgeOpacity(this: any, raw: unknown) {
      const untilTs = this.parseDonationBadgeUntilTs(raw);
      if (!untilTs) return 0;

      const nowTs = Number(this.badgeNowTs || Date.now());
      const remaining = untilTs - nowTs;
      if (remaining <= 0) return 0;
      if (remaining >= DONATION_BADGE_FADE_MS) return 1;
      return Math.max(0, Math.min(1, remaining / DONATION_BADGE_FADE_MS));
    },

    hasDonationBadge(this: any, user: User | null) {
      return this.getDonationBadgeOpacity(user?.donationBadgeUntil) > 0;
    },

    getDonationBadgeStyle(this: any, user: User | null) {
      return {
        opacity: this.getDonationBadgeOpacity(user?.donationBadgeUntil),
      };
    },

    hasMessageAuthorDonationBadge(this: any, message: Message) {
      return this.getDonationBadgeOpacity(message?.authorDonationBadgeUntil) > 0;
    },

    getMessageAuthorDonationBadgeOpacity(this: any, message: Message) {
      return this.getDonationBadgeOpacity(message?.authorDonationBadgeUntil);
    },

    hasNotificationAuthorDonationBadge(this: any, notification: NotificationItem) {
      return this.getDonationBadgeOpacity(notification?.authorDonationBadgeUntil) > 0;
    },

    getNotificationAuthorDonationBadgeStyle(this: any, notification: NotificationItem) {
      return {
        opacity: this.getDonationBadgeOpacity(notification?.authorDonationBadgeUntil),
      };
    },

    getUserNameStyle(this: any, user: User | null) {
      if (!user?.nicknameColor) return {};
      return {color: user.nicknameColor};
    },

    getAuthorStyle(this: any, message: Message) {
      if (!message.authorNicknameColor) return {};
      return {color: message.authorNicknameColor};
    },

    normalizeMessage(this: any, message: any): Message {
      const rawText = String(message?.rawText ?? message?.body ?? '');
      const renderedPreviews = Array.isArray(message?.renderedPreviews) ? message.renderedPreviews : [];
      return {
        ...message,
        rawText,
        authorDonationBadgeUntil: message?.authorDonationBadgeUntil
          ? String(message.authorDonationBadgeUntil)
          : null,
        renderedHtml: String(message?.renderedHtml ?? ''),
        renderedPreviews,
        reactions: Array.isArray(message?.reactions) ? message.reactions : [],
      } as Message;
    },

    getMessageRawText(this: any, messageRaw: any) {
      return String(messageRaw?.rawText ?? messageRaw?.body ?? '');
    },

    resetMessagePreviewCache(this: any) {
      // server-side rendering: no frontend message html/preview cache
    },

    formatMessageTime(this: any, createdAt: string) {
      const date = new Date(createdAt);
      if (Number.isNaN(date.getTime())) return '00:00:00';

      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    },

    focusMessageInputToEnd(this: any) {
      nextTick(() => {
        const input = this.messageInputEl as HTMLTextAreaElement | null;
        if (!input) return;
        input.focus();
        const offset = input.value.length;
        input.setSelectionRange(offset, offset);
      });
    },

    appendToInput(this: any, text: string) {
      const current = String(this.messageText || '');
      const needsSpace = current.length > 0 && !/\s$/.test(current);
      this.messageText = needsSpace ? `${current} ${text}` : `${current}${text}`;
      this.focusMessageInputToEnd();
    },

    composerNamedColors(this: any) {
      return COMPOSER_NAMED_COLORS;
    },

    composerEmojis(this: any) {
      return COMPOSER_EMOJIS;
    },

    toggleComposerTools(this: any) {
      this.hapticTap();
      this.composerToolsOpen = !this.composerToolsOpen;
      if (this.composerToolsOpen) {
        this.captureInputSelection();
      }
    },

    closeComposerTools(this: any) {
      this.composerToolsOpen = false;
    },

    captureInputSelection(this: any) {
      const input = this.messageInputEl as HTMLTextAreaElement | null;
      if (!input) return;
      const start = Number.isFinite(input.selectionStart) ? Number(input.selectionStart) : 0;
      const end = Number.isFinite(input.selectionEnd) ? Number(input.selectionEnd) : start;
      this.composerSelectionStart = Math.max(0, start);
      this.composerSelectionEnd = Math.max(this.composerSelectionStart, end);
    },

    getMessageInputRange(this: any) {
      const textLength = String(this.messageText || '').length;
      const input = this.messageInputEl as HTMLTextAreaElement | null;
      const inputFocused = !!input && document.activeElement === input;
      const activeStart = inputFocused && Number.isFinite(input.selectionStart) ? Number(input.selectionStart) : null;
      const activeEnd = inputFocused && Number.isFinite(input.selectionEnd) ? Number(input.selectionEnd) : null;
      const startBase = activeStart !== null ? activeStart : Number(this.composerSelectionStart || 0);
      const endBase = activeEnd !== null ? activeEnd : Number(this.composerSelectionEnd || startBase);
      const start = Math.min(Math.max(0, startBase), textLength);
      const end = Math.min(Math.max(start, endBase), textLength);
      return {start, end};
    },

    setMessageInputSelection(this: any, startRaw: number, endRaw: number) {
      const start = Math.max(0, Number(startRaw || 0));
      const end = Math.max(start, Number(endRaw || start));
      this.composerSelectionStart = start;
      this.composerSelectionEnd = end;

      nextTick(() => {
        const input = this.messageInputEl as HTMLTextAreaElement | null;
        if (!input) return;
        input.focus();
        input.setSelectionRange(start, end);
      });
    },

    applyWrapperToSelection(this: any, prefixRaw: string, suffixRaw = ')') {
      const prefix = String(prefixRaw || '');
      const suffix = String(suffixRaw || '');
      if (!prefix) return;

      const current = String(this.messageText || '');
      const {start, end} = this.getMessageInputRange();
      const selected = current.slice(start, end);
      const next = `${current.slice(0, start)}${prefix}${selected}${suffix}${current.slice(end)}`;
      this.messageText = next;
      const hasSelection = end > start;
      const cursorStart = start + prefix.length;
      const cursorEnd = hasSelection ? cursorStart + selected.length : cursorStart;
      this.setMessageInputSelection(cursorStart, cursorEnd);
    },

    applyNamedColorWrapper(this: any, colorNameRaw: unknown) {
      this.hapticTap();
      const colorName = String(colorNameRaw || '').trim().toLowerCase();
      if (!colorName) return;
      this.applyWrapperToSelection(`c#${colorName}(`);
      this.closeComposerTools();
    },

    applyCustomColorWrapper(this: any) {
      this.hapticTap();
      const color = String(this.composerColorPicker || '').trim();
      if (!COLOR_HEX_FULL_RE.test(color)) {
        this.closeComposerTools();
        return;
      }
      const normalized = color.toUpperCase();
      this.composerColorPicker = normalized;
      this.applyWrapperToSelection(`c${normalized}(`);
      this.closeComposerTools();
    },

    applyFormatWrapper(this: any, tagRaw: unknown) {
      this.hapticTap();
      const tag = String(tagRaw || '').trim().toLowerCase();
      if (!['b', 'u', 's', 'h', 'm'].includes(tag)) {
        this.closeComposerTools();
        return;
      }
      this.applyWrapperToSelection(`${tag}(`);
      this.closeComposerTools();
    },

    insertComposerText(this: any, textRaw: unknown) {
      const insertText = String(textRaw ?? '');
      if (!insertText) return;

      const current = String(this.messageText || '');
      const {start, end} = this.getMessageInputRange();
      this.messageText = `${current.slice(0, start)}${insertText}${current.slice(end)}`;
      const cursor = start + insertText.length;
      this.setMessageInputSelection(cursor, cursor);
    },

    onComposerEmojiClick(this: any, emojiRaw: unknown) {
      this.hapticTap();
      const emoji = String(emojiRaw || '');
      if (!emoji) {
        this.closeComposerTools();
        return;
      }
      this.insertComposerText(emoji);
      this.closeComposerTools();
    },

    openGalleryPicker(this: any) {
      const input = this.galleryInputEl as HTMLInputElement | null;
      if (!input) {
        this.closeComposerTools();
        return;
      }
      this.hapticTap();
      this.closeComposerTools();
      input.click();
    },

    async attachImageFiles(this: any, filesRaw: File[]) {
      const files = Array.isArray(filesRaw) ? filesRaw : [];
      if (!files.length) return;
      if (!this.activeDialog || this.pasteUploading) return;

      this.pasteUploading = true;
      this.error = '';

      try {
        for (const sourceFile of files) {
          const preparedFile = await this.preparePastedImage(sourceFile);
          if (!preparedFile) {
            this.error = 'Картинка слишком большая даже после сжатия.';
            continue;
          }

          const uploadResult = await this.uploadImageFile(preparedFile);
          if (!(uploadResult as any)?.ok || !(uploadResult as any)?.url) {
            this.error = 'Не удалось загрузить картинку.';
            continue;
          }

          const url = String((uploadResult as any).url || '').trim();
          if (!url) {
            this.error = 'Не удалось загрузить картинку.';
            continue;
          }

          this.appendToInput(url);
        }
      } finally {
        this.pasteUploading = false;
        this.focusMessageInputToEnd();
      }
    },

    async onGalleryInputChange(this: any, event: Event) {
      const input = event.target as HTMLInputElement | null;
      const files = input?.files ? Array.from(input.files) : [];
      if (!files.length) {
        if (input) input.value = '';
        return;
      }

      await this.attachImageFiles(files);
      if (input) input.value = '';
    },

    async copyTextToClipboard(this: any, textRaw: unknown) {
      const text = String(textRaw ?? '');
      if (!text.trim()) return;

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', 'true');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          textarea.style.pointerEvents = 'none';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        this.pushToast('Буфер обмена', 'Код скопирован');
      } catch {
        this.error = 'Не удалось скопировать код.';
      }
    },

    onAuthorClick(this: any, message: Message) {
      this.hapticTap();
      this.appendToInput(`${this.formatUsername(message.authorNickname)}, `);
    },

    onMessageTimeClick(this: any, message: Message) {
      this.hapticTap();
      this.appendToInput(`${this.formatUsername(message.authorNickname)} [${this.formatMessageTime(message.createdAt)}], `);
    },

    canOpenDirectFromMessage(this: any, message: Message) {
      if (!this.me) return false;
      if (this.activeDialog?.kind === 'direct') return false;
      return this.me.id !== message.authorId;
    },

    async onDirectFromMessageClick(this: any, message: Message) {
      if (!this.canOpenDirectFromMessage(message)) return;
      this.hapticTap();
      await this.selectPrivate({
        id: message.authorId,
        nickname: message.authorNickname,
        name: message.authorName,
        nicknameColor: message.authorNicknameColor,
        donationBadgeUntil: message.authorDonationBadgeUntil || null,
      } as User, {haptic: false});
    },

    isOwnMessage(this: any, message: Message) {
      return this.me?.id === message.authorId;
    },

    startMessageEdit(this: any, message: Message) {
      if (!this.isOwnMessage(message)) return;
      this.hapticTap();
      this.editingMessageId = message.id;
      this.editingMessageText = this.getMessageRawText(message);
      this.reactionPickerMessageId = null;
      this.reactionTooltipVisible = false;
      nextTick(() => {
        const input = document.querySelector('.message-edit-input') as HTMLTextAreaElement | null;
        if (!input) return;
        input.focus();
        const offset = input.value.length;
        input.setSelectionRange(offset, offset);
      });
    },

    cancelMessageEdit(this: any) {
      this.editingMessageId = null;
      this.editingMessageText = '';
    },

    onEditingMessageTextUpdate(this: any, valueRaw: unknown) {
      this.editingMessageText = String(valueRaw ?? '');
    },

    applyMessageUpdate(this: any, messageRaw: any) {
      const message = this.normalizeMessage(messageRaw);
      this.messages = this.messages.map((item: Message) => {
        if (item.id !== message.id || item.roomId !== message.roomId) return item;
        return message;
      });
      this.resetMessagePreviewCache();
      this.notifyMessagesChanged();
    },

    applyMessageDelete(this: any, roomId: number, messageId: number) {
      if (this.editingMessageId === messageId) {
        this.cancelMessageEdit();
      }
      if (this.reactionPickerMessageId === messageId) {
        this.reactionPickerMessageId = null;
      }
      this.messages = this.messages.filter((message: Message) => {
        return !(message.roomId === roomId && message.id === messageId);
      });
      this.resetMessagePreviewCache();
      this.notifyMessagesChanged();
      this.updateScrollDownVisibility();
    },

    async saveMessageEdit(this: any, message: Message) {
      if (!this.isOwnMessage(message)) return;
      this.hapticTap();
      const body = String(this.editingMessageText || '').trim();
      if (!body) {
        this.error = 'Сообщение не может быть пустым.';
        return;
      }

      this.messageActionPendingId = message.id;
      try {
        const result = await ws.request('chat:edit', message.id, body);
        if (!(result as any)?.ok) {
          this.error = 'Не удалось отредактировать сообщение.';
          return;
        }

        this.applyMessageUpdate((result as any).message);
        this.cancelMessageEdit();
      } finally {
        this.messageActionPendingId = null;
      }
    },

    async deleteOwnMessage(this: any, message: Message) {
      if (!this.isOwnMessage(message)) return;
      this.hapticTap();
      if (!window.confirm('Удалить это сообщение?')) return;

      this.messageActionPendingId = message.id;
      try {
        const result = await ws.request('chat:delete', message.id);
        if (!(result as any)?.ok) {
          this.error = 'Не удалось удалить сообщение.';
          return;
        }

        this.applyMessageDelete((result as any).roomId, (result as any).messageId);
        await this.fetchDirectDialogs();
      } finally {
        this.messageActionPendingId = null;
      }
    },

    onEditMessageKeydown(this: any, event: KeyboardEvent, message: Message) {
      if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      void this.saveMessageEdit(message);
    },

    extractMentionTokens(this: any, bodyRaw: unknown) {
      const body = String(bodyRaw || '');
      const tokens: string[] = [];
      MENTION_TAG_RE.lastIndex = 0;
      for (const match of body.matchAll(MENTION_TAG_RE)) {
        const nickname = String(match[1] || '').trim().toLowerCase();
        if (!nickname) continue;
        tokens.push(nickname);
      }
      return tokens;
    },

    hasMentionToken(this: any, bodyRaw: unknown, nicknameRaw: unknown) {
      const nickname = String(nicknameRaw || '').trim().toLowerCase();
      if (!nickname) return false;
      return this.extractMentionTokens(bodyRaw).includes(nickname);
    },

    containsAllKeyword(this: any, body: string) {
      return this.hasMentionToken(body, 'all');
    },

    isMentionedForMe(this: any, message: Message) {
      const meNickname = String(this.me?.nickname || '').toLowerCase();
      if (message.authorId === this.me?.id) return false;
      if (this.containsAllKeyword(this.getMessageRawText(message))) return true;
      if (!meNickname) return false;
      return this.hasMentionToken(this.getMessageRawText(message), meNickname);
    },
};
