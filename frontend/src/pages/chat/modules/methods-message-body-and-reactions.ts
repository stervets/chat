import {
  PINNED_PANEL_HEIGHT_RATIO_STORAGE_KEY,
  getPinnedCollapsedStorageKey,
  loadBooleanSetting,
  loadNumberSetting,
  nextTick,
  persistBooleanSetting,
  persistNumberSetting,
  ws,
  wsObject,
  REACTION_EMOJIS,
  VIRTUAL_MAX_ITEMS,
} from './shared';
import type {
  Message,
  MessageReaction,
  User,
  LinkPreview,
} from './shared';
export const chatMethodsMessageBodyAndReactions = {
    clampPinnedPanelHeightRatio(this: any, valueRaw: unknown) {
      const value = Number(valueRaw);
      if (!Number.isFinite(value)) return 0.24;
      return Math.min(0.5, Math.max(0.14, value));
    },

    loadPinnedCollapsedState(this: any, roomIdRaw: unknown) {
      const key = getPinnedCollapsedStorageKey(roomIdRaw);
      if (!key) return false;
      return loadBooleanSetting(key, false);
    },

    persistPinnedCollapsedState(this: any, roomIdRaw: unknown, valueRaw: unknown) {
      const key = getPinnedCollapsedStorageKey(roomIdRaw);
      if (!key) return;
      persistBooleanSetting(key, !!valueRaw);
    },

    loadPinnedPanelLayoutState(this: any) {
      this.pinnedPanelHeightRatio = this.clampPinnedPanelHeightRatio(
        loadNumberSetting(PINNED_PANEL_HEIGHT_RATIO_STORAGE_KEY, 0.24, 0.14, 0.5),
      );
      if (!this.activeDialog?.id) return;
      this.pinnedCollapsed = this.loadPinnedCollapsedState(this.activeDialog.id);
    },

    persistPinnedPanelHeightRatio(this: any) {
      persistNumberSetting(
        PINNED_PANEL_HEIGHT_RATIO_STORAGE_KEY,
        this.clampPinnedPanelHeightRatio(this.pinnedPanelHeightRatio),
        0.14,
        0.5,
      );
    },

    bindPinnedSplitterDragHandlers(this: any) {
      if (typeof window === 'undefined') return;
      window.addEventListener('pointermove', this.onPinnedSplitterPointerMove);
      window.addEventListener('pointerup', this.onPinnedSplitterPointerUp);
      window.addEventListener('pointercancel', this.onPinnedSplitterPointerUp);

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },

    unbindPinnedSplitterDragHandlers(this: any) {
      if (typeof window === 'undefined') return;
      window.removeEventListener('pointermove', this.onPinnedSplitterPointerMove);
      window.removeEventListener('pointerup', this.onPinnedSplitterPointerUp);
      window.removeEventListener('pointercancel', this.onPinnedSplitterPointerUp);

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },

    onPinnedSplitterPointerDown(this: any, event: PointerEvent) {
      if (!this.shouldShowPinnedPanel || this.pinnedCollapsed) return;
      if (typeof window === 'undefined') return;

      const contentEl = this.chatContentEl as HTMLElement | null;
      if (!contentEl) return;
      const rect = contentEl.getBoundingClientRect();
      const containerHeight = Number(rect.height || 0);
      if (!Number.isFinite(containerHeight) || containerHeight <= 0) return;

      this.pinnedSplitterDragState = {
        startY: Number(event.clientY || 0),
        startRatio: this.clampPinnedPanelHeightRatio(this.pinnedPanelHeightRatio),
        containerHeight,
      };
      this.bindPinnedSplitterDragHandlers();
    },

    onPinnedSplitterPointerMove(this: any, event: PointerEvent) {
      const state = this.pinnedSplitterDragState;
      if (!state) return;
      const deltaY = Number(event.clientY || 0) - Number(state.startY || 0);
      const next = Number(state.startRatio || 0) + (deltaY / Number(state.containerHeight || 1));
      this.pinnedPanelHeightRatio = this.clampPinnedPanelHeightRatio(next);
    },

    onPinnedSplitterPointerUp(this: any) {
      if (!this.pinnedSplitterDragState) return;
      this.persistPinnedPanelHeightRatio();
      this.stopPinnedSplitterDrag();
    },

    stopPinnedSplitterDrag(this: any) {
      this.pinnedSplitterDragState = null;
      this.unbindPinnedSplitterDragHandlers();
    },

    escapeHtml(this: any, valueRaw: unknown) {
      return String(valueRaw ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    decodeHtmlEntities(this: any, valueRaw: unknown) {
      return String(valueRaw ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&amp;/g, '&');
    },

    getRenderedMessageHtml(this: any, message: Message, _sourceIndex: number) {
      const rendered = String(message?.renderedHtml || '').trim();
      if (rendered) return rendered;
      return this.escapeHtml(this.getMessageRawText(message));
    },

    onMessageBodyClick(this: any, event: MouseEvent, _message: Message, _sourceIndex: number) {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const imageSrc = this.resolveImageSrcFromTarget(target);
      if (imageSrc) {
        event.preventDefault();
        this.hapticTap();
        this.openImageViewer(imageSrc);
        return;
      }

      const spoilerEl = target.closest('.message-spoiler') as HTMLElement | null;
      if (spoilerEl) {
        const bodyEl = target.closest('.message-body') as HTMLElement | null;
        const alreadyRevealed = !!bodyEl?.classList.contains('message-body-show-hidden');
        if (!alreadyRevealed) {
          this.hapticTap();
        }
      }

      const codeEl = target.closest('code') as HTMLElement | null;
      if (codeEl) {
        this.timeTooltipVisible = false;
        void this.copyTextToClipboard(codeEl.textContent || '');
        return;
      }

      const mentionEl = target.closest('.mention-token') as HTMLElement | null;
      if (mentionEl?.dataset?.mention) {
        this.timeTooltipVisible = false;
        this.appendToInput(`${mentionEl.dataset.mention}, `);
        return;
      }

      const timeRefEl = target.closest('.time-reference') as HTMLElement | null;
      if (timeRefEl?.dataset?.targetMessageId) {
        this.timeTooltipVisible = false;
        this.hapticTap();
        const targetMessageId = Number.parseInt(timeRefEl.dataset.targetMessageId, 10);
        if (Number.isFinite(targetMessageId) && targetMessageId > 0) {
          void this.scrollToMessageById(targetMessageId);
        }
        return;
      }
    },

    resolveImageSrcFromTarget(this: any, target: HTMLElement | null) {
      if (!target) return '';

      const imageEl = target.closest('img.preview-inline-image, img.preview-image') as HTMLImageElement | null;
      if (imageEl?.src) {
        return String(imageEl.currentSrc || imageEl.src || '').trim();
      }

      const imageLink = target.closest('a.inline-image-link') as HTMLAnchorElement | null;
      if (imageLink?.href) {
        return String(imageLink.href || '').trim();
      }

      return '';
    },

    onMessageImageClick(this: any, imageSrcRaw: unknown) {
      const imageSrc = String(imageSrcRaw || '').trim();
      if (!imageSrc) return;
      this.hapticTap();
      this.openImageViewer(imageSrc);
    },

    openImageViewer(this: any, imageSrcRaw: unknown, imageAltRaw?: unknown) {
      const imageSrc = String(imageSrcRaw || '').trim();
      if (!imageSrc) return;

      this.imageViewerSrc = imageSrc;
      this.imageViewerAlt = String(imageAltRaw || 'image preview').trim() || 'image preview';
      this.imageViewerVisible = true;

      if (typeof document === 'undefined') return;
      if (this.imageViewerBodyOverflow === null) {
        this.imageViewerBodyOverflow = document.body.style.overflow || '';
      }
      document.body.style.overflow = 'hidden';
    },

    closeImageViewer(this: any) {
      if (typeof document !== 'undefined') {
        if (this.imageViewerBodyOverflow !== null) {
          document.body.style.overflow = this.imageViewerBodyOverflow;
        }
      }
      this.imageViewerBodyOverflow = null;
      this.imageViewerVisible = false;
      this.imageViewerSrc = '';
      this.imageViewerAlt = '';
    },

    onImageViewerBackdropClick(this: any, event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.image-viewer-media')) return;
      if (target?.closest('.image-viewer-close')) return;
      this.closeImageViewer();
    },

    onMessageBodyMouseMove(this: any, event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const timeRefEl = target.closest('.time-reference') as HTMLElement | null;
      if (!timeRefEl) {
        this.timeTooltipVisible = false;
        return;
      }

      const tooltipRaw = String(timeRefEl.dataset.timeTooltip || '').trim();
      if (!tooltipRaw) {
        this.timeTooltipVisible = false;
        return;
      }

      this.timeTooltipText = this.decodeHtmlEntities(tooltipRaw);
      this.timeTooltipVisible = true;
      this.updateTimeTooltipPosition(event);
    },

    onMessageBodyMouseLeave(this: any) {
      this.timeTooltipVisible = false;
    },

    async scrollToMessageById(this: any, messageId: number) {
      if (!this.messagesEl) return false;

      const targetIndex = this.messages.findIndex((message: Message) => message.id === messageId);
      if (targetIndex < 0) return false;

      if (this.messages.length > VIRTUAL_MAX_ITEMS) {
        const centerOffset = Math.floor(VIRTUAL_MAX_ITEMS / 2);
        const start = Math.max(0, targetIndex - centerOffset);
        this.virtualRangeStart = start;
        this.virtualRangeEnd = Math.min(this.messages.length, start + VIRTUAL_MAX_ITEMS);
        await nextTick();
      }

      this.rebuildVirtualPrefix();
      const prefix = this.virtualPrefixHeights;
      const topOffset = Array.isArray(prefix) ? Number(prefix[targetIndex] || 0) : 0;
      const estimatedHeight = this.estimateMessageHeight(this.messages[targetIndex]);
      const clientHeight = Number(this.messagesEl.clientHeight || 0);
      this.messagesEl.scrollTo({
        top: Math.max(0, topOffset - Math.floor((clientHeight - estimatedHeight) / 2)),
        behavior: 'auto',
      });

      this.syncVirtualWindowFromScroll();
      await nextTick();

      const target = this.messagesEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
      if (!target) return false;

      const hostRect = this.messagesEl.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desiredTop = hostRect.top + Math.max(0, (hostRect.height - targetRect.height) / 2);
      const delta = targetRect.top - desiredTop;
      if (Math.abs(delta) > 1) {
        this.messagesEl.scrollTop = Math.max(0, this.messagesEl.scrollTop + delta);
      }

      this.scheduleVirtualSync();
      this.triggerMessageBlink(messageId);
      return true;
    },

    async pinMessage(this: any, message: Message) {
      if (!this.activeDialog?.id) return false;
      const result = await ws.request('room:pin:set', {
        roomId: this.activeDialog.id,
        nodeId: message.id,
      });
      if (!(result as any)?.ok) {
        this.error = (result as any)?.error === 'forbidden'
          ? 'Только админ комнаты может закреплять.'
          : 'Не удалось закрепить сообщение.';
        return false;
      }

      const pinnedMessageRaw = wsObject(result).pinnedMessage;
      this.activePinnedMessage = pinnedMessageRaw && typeof pinnedMessageRaw === 'object'
        ? this.normalizeMessage(pinnedMessageRaw)
        : this.normalizeMessage(message);
      return true;
    },

    async unpinActiveMessage(this: any) {
      if (!this.activeDialog?.id) return false;
      const result = await ws.request('room:pin:clear', {
        roomId: this.activeDialog.id,
      });
      if (!(result as any)?.ok) {
        this.error = (result as any)?.error === 'forbidden'
          ? 'Только админ комнаты может удалять закреп.'
          : 'Не удалось открепить сообщение.';
        return false;
      }
      this.activePinnedMessage = null;
      return true;
    },

    async onTogglePinnedMessage(this: any, message: Message) {
      this.hapticTap();
      if (!this.canManagePinnedMessages) return;
      if (Number(this.activePinnedMessage?.id || 0) === Number(message.id || 0)) {
        await this.unpinActiveMessage();
        return;
      }
      await this.pinMessage(message);
    },

    onChatPinned(this: any, payloadRaw: any) {
      const roomId = Number(payloadRaw?.roomId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      if (Number(this.activeDialog?.id || 0) !== roomId) return;
      const pinnedNodeId = Number(payloadRaw?.pinnedNodeId || 0) || null;
      if (this.activeDialog?.kind === 'direct') {
        this.activePinnedMessage = null;
        this.activeDialog = {
          ...this.activeDialog,
          pinnedNodeId: null,
          roomSurface: this.normalizeRoomSurface(this.activeDialog?.roomSurface, null),
        };
        return;
      }

      const pinnedMessageRaw = payloadRaw?.pinnedMessage;
      if (pinnedMessageRaw && typeof pinnedMessageRaw === 'object') {
        this.activePinnedMessage = this.normalizeMessage(pinnedMessageRaw);
        this.activeDialog = {
          ...this.activeDialog,
          pinnedNodeId: Number(this.activePinnedMessage?.id || 0) || pinnedNodeId,
          roomSurface: this.normalizeRoomSurface({
            ...(this.activeDialog?.roomSurface || {}),
            pinnedNodeId: Number(this.activePinnedMessage?.id || 0) || pinnedNodeId,
            pinnedKind: this.activePinnedMessage?.kind || null,
          }, this.activePinnedMessage?.id || pinnedNodeId),
        };
        this.pinnedCollapsed = this.loadPinnedCollapsedState(roomId);
        return;
      }
      this.activePinnedMessage = null;
      this.activeDialog = {
        ...this.activeDialog,
        pinnedNodeId: null,
        roomSurface: this.normalizeRoomSurface({
          ...(this.activeDialog?.roomSurface || {}),
          pinnedNodeId: null,
          pinnedKind: null,
        }, null),
      };
    },

    togglePinnedCollapsed(this: any) {
      if (!this.shouldShowPinnedPanel) return;
      this.hapticTap();
      const next = !this.pinnedCollapsed;
      this.pinnedCollapsed = next;
      this.persistPinnedCollapsedState(this.activeDialog?.id, next);
    },

    onPinnedBodyClick(this: any, event: MouseEvent) {
      if (this.pinnedCollapsed) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const imageSrc = this.resolveImageSrcFromTarget(target);
      if (!imageSrc) return;

      event.preventDefault();
      this.hapticTap();
      this.openImageViewer(imageSrc);
    },

    getMessageExtraPreviews(this: any, message: Message) {
      const previews = Array.isArray(message?.renderedPreviews) ? message.renderedPreviews : [];
      return previews.filter((preview: LinkPreview) => preview.type !== 'image');
    },

    reactionPalette(this: any) {
      return REACTION_EMOJIS;
    },

    findMyReactionEmoji(this: any, message: Message) {
      if (!this.me?.id) return null;
      for (const reaction of (message.reactions || [])) {
        if (reaction.users.some((user: User) => user.id === this.me.id)) {
          return reaction.emoji;
        }
      }
      return null;
    },

    isMyReaction(this: any, reaction: MessageReaction) {
      if (!this.me?.id) return false;
      return (reaction.users || []).some((user: User) => user.id === this.me.id);
    },

    toggleReactionPicker(this: any, message: Message) {
      this.hapticTap();
      this.reactionPickerMessageId = this.reactionPickerMessageId === message.id
        ? null
        : message.id;
      this.reactionTooltipVisible = false;
    },

    async sendReaction(this: any, message: Message, emoji: string | null) {
      const result = await ws.request('message:reaction:set', {
        messageId: message.id,
        emoji,
      });
      if (!(result as any)?.ok) {
        this.error = 'Не удалось поставить реакцию.';
        return false;
      }

      const data = wsObject(result);
      this.applyMessageReactions(data.roomId, data.messageId, data.reactions);
      return true;
    },

    async onReactionSelect(this: any, message: Message, emoji: string) {
      this.hapticTap();
      const current = this.findMyReactionEmoji(message);
      const nextEmoji = current === emoji ? null : emoji;
      const ok = await this.sendReaction(message, nextEmoji);
      if (!ok) return;
      this.reactionPickerMessageId = null;
    },

    async onReactionChipClick(this: any, message: Message, reaction: MessageReaction) {
      this.hapticTap();
      const current = this.findMyReactionEmoji(message);
      const nextEmoji = current === reaction.emoji ? null : reaction.emoji;
      await this.sendReaction(message, nextEmoji);
    },

    applyMessageReactions(this: any, roomId: number, messageId: number, reactionsRaw: unknown) {
      const reactions = Array.isArray(reactionsRaw) ? reactionsRaw : [];
      this.messages = this.messages.map((message: Message) => {
        if (message.id !== messageId || message.roomId !== roomId) return message;
        return {
          ...message,
          reactions,
        };
      });
      this.notifyMessagesChanged();
    },

    onChatReactions(this: any, payload: any) {
      const roomId = Number(payload?.roomId);
      const messageId = Number(payload?.messageId);
      if (!Number.isFinite(roomId) || !Number.isFinite(messageId)) return;
      this.applyMessageReactions(roomId, messageId, payload?.reactions);
    },

    onChatReactionNotify(this: any, payload: any) {
      if (!payload?.actor?.id) return;
      this.addReactionNotification(payload);
    },

    reactionTooltipContent(this: any, reaction: MessageReaction) {
      const users = reaction.users || [];
      if (!users.length) return '';
      return users
        .map((user: User) => `${user.name} (${this.formatUsername(user.nickname)})`)
        .join('\n');
    },

    updateReactionTooltipPosition(this: any, event: MouseEvent) {
      this.reactionTooltipX = Math.min(event.clientX + 14, window.innerWidth - 16);
      this.reactionTooltipY = Math.min(event.clientY + 16, window.innerHeight - 16);
    },

    onReactionMouseEnter(this: any, event: MouseEvent, reaction: MessageReaction) {
      const content = this.reactionTooltipContent(reaction);
      if (!content) return;
      this.reactionTooltipText = content;
      this.reactionTooltipVisible = true;
      this.updateReactionTooltipPosition(event);
    },

    onReactionMouseMove(this: any, event: MouseEvent) {
      if (!this.reactionTooltipVisible) return;
      this.updateReactionTooltipPosition(event);
    },

    onReactionMouseLeave(this: any) {
      this.reactionTooltipVisible = false;
    },

    getReactionTooltipStyle(this: any) {
      return {
        left: `${this.reactionTooltipX}px`,
        top: `${this.reactionTooltipY}px`,
      };
    },

    updateTimeTooltipPosition(this: any, event: MouseEvent) {
      this.timeTooltipX = Math.min(event.clientX + 14, window.innerWidth - 16);
      this.timeTooltipY = Math.min(event.clientY + 16, window.innerHeight - 16);
    },

    getTimeTooltipStyle(this: any) {
      return {
        left: `${this.timeTooltipX}px`,
        top: `${this.timeTooltipY}px`,
      };
    },

    triggerMessageBlink(this: any, messageId: number) {
      if (this.blinkTimer) {
        clearTimeout(this.blinkTimer);
      }

      this.blinkMessageId = null;
      nextTick(() => {
        this.blinkMessageId = messageId;
        this.blinkTimer = window.setTimeout(() => {
          this.blinkMessageId = null;
          this.blinkTimer = null;
        }, 1100);
      });
    },

};
