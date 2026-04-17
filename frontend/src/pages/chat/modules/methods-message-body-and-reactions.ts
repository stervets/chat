import {
  nextTick,
  ws,
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
        const targetMessageId = Number.parseInt(timeRefEl.dataset.targetMessageId, 10);
        if (Number.isFinite(targetMessageId) && targetMessageId > 0) {
          void this.scrollToMessageById(targetMessageId);
        }
        return;
      }
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

      this.rebuildVirtualPrefix();
      const prefix = this.virtualPrefixHeights;
      const topOffset = Array.isArray(prefix) ? Number(prefix[targetIndex] || 0) : 0;
      const clientHeight = Number(this.messagesEl.clientHeight || 0);
      this.messagesEl.scrollTo({
        top: Math.max(0, topOffset - Math.floor(clientHeight / 2)),
        behavior: 'auto',
      });

      this.syncVirtualWindowFromScroll();
      await nextTick();

      let target = this.messagesEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
      if (!target) {
        const start = Math.max(0, targetIndex - Math.floor(VIRTUAL_MAX_ITEMS / 2));
        this.virtualRangeStart = start;
        this.virtualRangeEnd = Math.min(this.messages.length, start + VIRTUAL_MAX_ITEMS);
        await nextTick();
        target = this.messagesEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
      }
      if (!target) return false;

      target.scrollIntoView({behavior: 'smooth', block: 'center'});
      this.scheduleVirtualSync();
      this.triggerMessageBlink(messageId);
      return true;
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
      this.reactionPickerMessageId = this.reactionPickerMessageId === message.id
        ? null
        : message.id;
      this.reactionTooltipVisible = false;
    },

    async sendReaction(this: any, message: Message, emoji: string | null) {
      const result = await ws.request('chat:react', message.id, emoji);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось поставить реакцию.';
        return false;
      }

      this.applyMessageReactions((result as any).dialogId, (result as any).messageId, (result as any).reactions);
      return true;
    },

    async onReactionSelect(this: any, message: Message, emoji: string) {
      const current = this.findMyReactionEmoji(message);
      const nextEmoji = current === emoji ? null : emoji;
      const ok = await this.sendReaction(message, nextEmoji);
      if (!ok) return;
      this.reactionPickerMessageId = null;
    },

    async onReactionChipClick(this: any, message: Message, reaction: MessageReaction) {
      const current = this.findMyReactionEmoji(message);
      const nextEmoji = current === reaction.emoji ? null : reaction.emoji;
      await this.sendReaction(message, nextEmoji);
    },

    applyMessageReactions(this: any, dialogId: number, messageId: number, reactionsRaw: unknown) {
      const reactions = Array.isArray(reactionsRaw) ? reactionsRaw : [];
      this.messages = this.messages.map((message: Message) => {
        if (message.id !== messageId || message.dialogId !== dialogId) return message;
        return {
          ...message,
          reactions,
        };
      });
      this.notifyMessagesChanged();
    },

    onChatReactions(this: any, payload: any) {
      const dialogId = Number(payload?.dialogId);
      const messageId = Number(payload?.messageId);
      if (!Number.isFinite(dialogId) || !Number.isFinite(messageId)) return;
      this.applyMessageReactions(dialogId, messageId, payload?.reactions);
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
