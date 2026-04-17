import {ref, nextTick} from 'vue';
import type {Dialog, Message, MessageReaction, User} from '@/composables/types';
import {linkify} from '@/composables/utils';
import {ws} from '@/composables/classes/ws';
import {on, off} from '@/composables/event-bus';
import {getApiBase} from '@/composables/api';
import {
  getSessionToken,
  restoreSession,
  wsChangePassword,
  wsLogout,
  wsUpdateProfile,
} from '@/composables/ws-rpc';

type DirectDialog = {
  dialogId: number;
  targetUser: User;
  lastMessageAt: string;
};

type LinkPreview = {
  key: string;
  type: 'image' | 'video' | 'embed' | 'youtube';
  src: string;
  href?: string;
};

type NotificationItem = {
  id: number;
  dialogId: number;
  dialogKind: 'general' | 'private' | 'unknown';
  notificationType: 'message' | 'reaction';
  authorId: number;
  authorName: string;
  authorNickname: string;
  authorNicknameColor: string | null;
  body: string;
  createdAt: string;
  unread: boolean;
  targetUser: User | null;
  targetMessageId?: number;
  reactionEmoji?: string;
};

type ToastItem = {
  id: number;
  title: string;
  body: string;
};

const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TIME_TAG_RE = /\[(\d{2}:\d{2}:\d{2})\]/g;
const MENTION_TAG_RE = /@([a-zA-Z0-9._-]+)/g;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const REACTION_EMOJIS = ['🙂', '👍', '😂', '🔥', '❤️', '☹️', '😡', '👎', '😢'];
const MAX_PASTE_IMAGE_BYTES = 1024 * 1024;

export default {
  async setup() {
    return {
      router: useRouter(),

      me: ref<User | null>(null),
      users: ref<User[]>([]),
      directDialogs: ref<DirectDialog[]>([]),
      generalDialog: ref<Dialog | null>(null),
      activeDialog: ref<Dialog | null>(null),

      messages: ref<Message[]>([]),
      messageText: ref(''),
      editingMessageId: ref<number | null>(null),
      editingMessageText: ref(''),
      messageActionPendingId: ref<number | null>(null),
      error: ref(''),
      historyLoading: ref(false),
      historyLoadSeq: ref(0),
      messagesEl: ref<HTMLDivElement | null>(null),
      messageInputEl: ref<HTMLTextAreaElement | null>(null),
      showScrollDown: ref(false),
      forceOwnScrollDown: ref(false),
      blinkMessageId: ref<number | null>(null),
      blinkTimer: ref<number | null>(null),
      timeTooltipVisible: ref(false),
      timeTooltipText: ref(''),
      timeTooltipX: ref(0),
      timeTooltipY: ref(0),
      reactionTooltipVisible: ref(false),
      reactionTooltipText: ref(''),
      reactionTooltipX: ref(0),
      reactionTooltipY: ref(0),
      reactionPickerMessageId: ref<number | null>(null),
      messagePreviewCache: ref<Record<string, LinkPreview[]>>({}),
      faviconBlinkTimer: ref<number | null>(null),
      faviconBlinkAlertFrame: ref(false),
      inactiveTabUnread: ref(false),
      windowFocused: ref(true),
      documentVisible: ref(true),

      leftMenuOpen: ref(false),
      rightMenuOpen: ref(false),
      isCompactLayout: ref(false),
      searchQuery: ref(''),
      notificationsMenuOpen: ref(false),
      notifications: ref<NotificationItem[]>([]),
      notificationsSeq: ref(1),
      notificationMenuEl: ref<HTMLElement | null>(null),
      notificationButtonEl: ref<HTMLElement | null>(null),
      windowClickHandler: ref<Function | null>(null),
      toasts: ref<ToastItem[]>([]),
      toastTimerById: ref<Record<number, number>>({}),

      profileName: ref(''),
      profileNicknameColor: ref(''),
      profileColorPicker: ref('#61afef'),
      profileSaving: ref(false),
      profileError: ref(''),
      directDeletePending: ref(false),

      newPassword: ref(''),
      pasteUploading: ref(false),

      chatMessageHandler: ref<Function | null>(null),
      chatMessageUpdatedHandler: ref<Function | null>(null),
      chatMessageDeletedHandler: ref<Function | null>(null),
      chatReactionsHandler: ref<Function | null>(null),
      dialogsDeletedHandler: ref<Function | null>(null),
      chatReactionNotifyHandler: ref<Function | null>(null),
      disconnectedHandler: ref<Function | null>(null),
      windowKeydownHandler: ref<Function | null>(null),
      windowResizeHandler: ref<Function | null>(null),
      windowFocusHandler: ref<Function | null>(null),
      windowBlurHandler: ref<Function | null>(null),
      visibilityChangeHandler: ref<Function | null>(null),

      linkify,
    };
  },

  computed: {
    filteredUsers(this: any) {
      const query = this.searchQuery.trim().toLowerCase().replace(/^@+/, '');
      if (!query) return [];
      return this.users.filter((user: User) => {
        const byName = user.name.toLowerCase().includes(query);
        const byNickname = user.nickname.toLowerCase().includes(query);
        return byName || byNickname;
      });
    },

    unreadNotificationsCount(this: any) {
      return this.notifications.reduce((count: number, notification: NotificationItem) => {
        return notification.unread ? count + 1 : count;
      }, 0);
    },
  },

  methods: {
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

    getUserNameStyle(this: any, user: User | null) {
      if (!user?.nicknameColor) return {};
      return {color: user.nicknameColor};
    },

    getAuthorStyle(this: any, message: Message) {
      if (!message.authorNicknameColor) return {};
      return {color: message.authorNicknameColor};
    },

    normalizeMessage(this: any, message: any): Message {
      return {
        ...message,
        reactions: Array.isArray(message?.reactions) ? message.reactions : [],
      } as Message;
    },

    messagePreviewCacheKey(this: any, message: Message) {
      return `${message.id}:${message.body}`;
    },

    resetMessagePreviewCache(this: any) {
      this.messagePreviewCache = {};
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

    onAuthorClick(this: any, message: Message) {
      this.appendToInput(`${this.formatUsername(message.authorNickname)}, `);
    },

    onMessageTimeClick(this: any, message: Message) {
      this.appendToInput(`${this.formatUsername(message.authorNickname)} [${this.formatMessageTime(message.createdAt)}], `);
    },

    onMentionTokenClick(this: any, segment: any) {
      const username = String(segment?.username || '').trim();
      if (!username) return;
      this.appendToInput(`${username}, `);
    },

    canOpenDirectFromMessage(this: any, message: Message) {
      if (!this.me) return false;
      if (this.activeDialog?.kind === 'private') return false;
      return this.me.id !== message.authorId;
    },

    async onDirectFromMessageClick(this: any, message: Message) {
      if (!this.canOpenDirectFromMessage(message)) return;
      await this.selectPrivate({
        id: message.authorId,
        nickname: message.authorNickname,
        name: message.authorName,
        nicknameColor: message.authorNicknameColor,
      } as User);
    },

    isOwnMessage(this: any, message: Message) {
      return this.me?.id === message.authorId;
    },

    startMessageEdit(this: any, message: Message) {
      if (!this.isOwnMessage(message)) return;
      this.editingMessageId = message.id;
      this.editingMessageText = message.body;
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

    applyMessageUpdate(this: any, messageRaw: any) {
      const message = this.normalizeMessage(messageRaw);
      this.messages = this.messages.map((item: Message) => {
        if (item.id !== message.id || item.dialogId !== message.dialogId) return item;
        return message;
      });
      this.resetMessagePreviewCache();
    },

    applyMessageDelete(this: any, dialogId: number, messageId: number) {
      if (this.editingMessageId === messageId) {
        this.cancelMessageEdit();
      }
      if (this.reactionPickerMessageId === messageId) {
        this.reactionPickerMessageId = null;
      }
      this.messages = this.messages.filter((message: Message) => {
        return !(message.dialogId === dialogId && message.id === messageId);
      });
      this.resetMessagePreviewCache();
      this.updateScrollDownVisibility();
    },

    async saveMessageEdit(this: any, message: Message) {
      if (!this.isOwnMessage(message)) return;
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
      if (!window.confirm('Удалить это сообщение?')) return;

      this.messageActionPendingId = message.id;
      try {
        const result = await ws.request('chat:delete', message.id);
        if (!(result as any)?.ok) {
          this.error = 'Не удалось удалить сообщение.';
          return;
        }

        this.applyMessageDelete((result as any).dialogId, (result as any).messageId);
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
      if (this.containsAllKeyword(message.body)) return true;
      if (!meNickname) return false;
      return this.hasMentionToken(message.body, meNickname);
    },

    getNotificationDialogTitle(this: any, notification: NotificationItem) {
      if (notification.dialogKind === 'general') return 'Общий чат';
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
      if (this.unreadNotificationsCount > 0 || this.inactiveTabUnread) {
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

    pushToast(this: any, title: string, body: string) {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      this.toasts = [{id, title, body}, ...this.toasts].slice(0, 4);

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

    addNotificationFromMessage(this: any, message: Message) {
      const notificationId = this.notificationsSeq;
      this.notificationsSeq += 1;
      const generalId = this.generalDialog?.id || null;
      const hasDirectDialog = this.directDialogs.some((dialog: DirectDialog) => dialog.dialogId === message.dialogId);
      const dialogKind = generalId && message.dialogId === generalId
        ? 'general'
        : (hasDirectDialog ? 'private' : 'unknown');

      const targetUser = this.me?.id === message.authorId
        ? null
        : {
          id: message.authorId,
          nickname: message.authorNickname,
          name: message.authorName,
          nicknameColor: message.authorNicknameColor,
        } as User;

      const notification: NotificationItem = {
        id: notificationId,
        dialogId: message.dialogId,
        dialogKind,
        notificationType: 'message',
        authorId: message.authorId,
        authorName: message.authorName,
        authorNickname: message.authorNickname,
        authorNicknameColor: message.authorNicknameColor,
        body: message.body,
        createdAt: message.createdAt,
        unread: true,
        targetUser,
      };

      this.notifications = [notification, ...this.notifications].slice(0, 50);
      this.pushToast(
        this.getNotificationDialogTitle(notification),
        `${notification.authorName}: ${this.getNotificationBodyPreview(notification)}`
      );
      this.updateFaviconBlinkByUnread();
    },

    addReactionNotification(this: any, payload: any) {
      const actor = payload?.actor;
      if (!actor?.id) return;

      const dialogId = Number(payload?.dialogId);
      if (!Number.isFinite(dialogId)) return;

      const notificationId = this.notificationsSeq;
      this.notificationsSeq += 1;

      const generalId = this.generalDialog?.id || null;
      const hasDirectDialog = this.directDialogs.some((dialog: DirectDialog) => dialog.dialogId === dialogId);
      const dialogKind = generalId && dialogId === generalId
        ? 'general'
        : (hasDirectDialog ? 'private' : 'unknown');

      const targetUser = this.me?.id === actor.id
        ? null
        : {
          id: actor.id,
          nickname: actor.nickname,
          name: actor.name,
          nicknameColor: actor.nicknameColor || null,
        } as User;

      const sourceBody = String(payload?.messageBody || '').replace(/\s+/g, ' ').trim();
      const preview = sourceBody
        ? (sourceBody.length > 80 ? `${sourceBody.slice(0, 77)}...` : sourceBody)
        : '(пусто)';
      const emoji = String(payload?.emoji || '').trim();
      const body = `реакция ${emoji} на: ${preview}`;

      const notification: NotificationItem = {
        id: notificationId,
        dialogId,
        dialogKind,
        notificationType: 'reaction',
        authorId: actor.id,
        authorName: actor.name,
        authorNickname: actor.nickname,
        authorNicknameColor: actor.nicknameColor || null,
        body,
        createdAt: String(payload?.createdAt || new Date().toISOString()),
        unread: true,
        targetUser,
        targetMessageId: Number(payload?.messageId) || undefined,
        reactionEmoji: emoji || undefined,
      };

      this.notifications = [notification, ...this.notifications].slice(0, 50);
      this.pushToast(
        this.getNotificationDialogTitle(notification),
        `${notification.authorName}: ${this.getNotificationBodyPreview(notification)}`
      );
      this.updateFaviconBlinkByUnread();
    },

    markNotificationsRead(this: any) {
      this.notifications = this.notifications.map((notification: NotificationItem) => ({
        ...notification,
        unread: false,
      }));
      this.updateFaviconBlinkByUnread();
    },

    toggleNotificationsMenu(this: any) {
      this.notificationsMenuOpen = !this.notificationsMenuOpen;
      if (this.notificationsMenuOpen) {
        this.markNotificationsRead();
        this.rightMenuOpen = false;
        this.leftMenuOpen = false;
      }
    },

    closeNotificationsMenu(this: any) {
      this.notificationsMenuOpen = false;
    },

    onWindowClick(this: any, event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      const targetEl = target instanceof HTMLElement ? target : target.parentElement;
      const inReactionControls = !!targetEl?.closest('.reaction-controls');
      if (!inReactionControls) {
        this.reactionPickerMessageId = null;
        this.reactionTooltipVisible = false;
      }

      if (!this.notificationsMenuOpen) return;

      const inMenu = this.notificationMenuEl?.contains(target);
      const inButton = this.notificationButtonEl?.contains(target);
      if (inMenu || inButton) return;

      this.closeNotificationsMenu();
    },

    async openNotification(this: any, notification: NotificationItem) {
      const targetMessageId = Number(notification.targetMessageId || 0) || null;

      if (notification.dialogKind === 'general' && this.generalDialog) {
        await this.selectDialog(this.generalDialog);
        this.closeNotificationsMenu();
        if (targetMessageId) {
          await nextTick();
          this.scrollToMessageById(targetMessageId);
        }
        return;
      }

      const direct = this.directDialogs.find((dialog: DirectDialog) => dialog.dialogId === notification.dialogId);
      if (direct) {
        await this.selectDialog({
          id: direct.dialogId,
          kind: 'private',
          targetUser: direct.targetUser,
          title: direct.targetUser.name,
        });
        this.closeNotificationsMenu();
        if (targetMessageId) {
          await nextTick();
          this.scrollToMessageById(targetMessageId);
        }
        return;
      }

      if (notification.targetUser && notification.dialogKind !== 'general') {
        await this.selectPrivate(notification.targetUser);
        if (targetMessageId) {
          await nextTick();
          this.scrollToMessageById(targetMessageId);
        }
      }
      this.closeNotificationsMenu();
    },

    buildTimeTagTooltip(this: any, message: Message) {
      const normalized = message.body.replace(/\s+/g, ' ').trim();
      const preview = normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
      return `${this.formatUsername(message.authorNickname)}: ${preview || '(пусто)'}`;
    },

    findClosestMessageByTime(this: any, sourceIndex: number, timeLabel: string) {
      let bestMessage: Message | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      this.messages.forEach((message: Message, index: number) => {
        if (this.formatMessageTime(message.createdAt) !== timeLabel) return;
        const distance = Math.abs(index - sourceIndex);
        if (distance >= bestDistance) return;
        bestDistance = distance;
        bestMessage = message;
      });

      return bestMessage;
    },

    normalizeMessageLink(this: any, rawUrl: string) {
      return String(rawUrl || '').replace(/[),.;!?]+$/g, '');
    },

    shouldHideImageLink(this: any, rawUrl: string) {
      const normalizedUrl = this.normalizeMessageLink(rawUrl);
      const preview = this.buildLinkPreview(normalizedUrl);
      return preview?.type === 'image';
    },

    findMentionUser(this: any, nicknameRaw: unknown) {
      const nickname = String(nicknameRaw || '').trim().toLowerCase();
      if (!nickname) return null;

      if (String(this.me?.nickname || '').toLowerCase() === nickname) {
        return this.me as User;
      }

      const byUsers = this.users.find((user: User) => user.nickname.toLowerCase() === nickname);
      if (byUsers) return byUsers;

      const byDialogs = this.directDialogs
        .map((dialog: DirectDialog) => dialog.targetUser)
        .find((user: User) => user.nickname.toLowerCase() === nickname);
      if (byDialogs) return byDialogs;

      return null;
    },

    pushMentionSegments(this: any, segments: any[], textRaw: string) {
      const text = String(textRaw || '');
      if (!text) return;

      let lastIndex = 0;
      MENTION_TAG_RE.lastIndex = 0;
      for (const match of text.matchAll(MENTION_TAG_RE)) {
        if (match.index === undefined) continue;

        if (match.index > lastIndex) {
          segments.push({
            type: 'text',
            value: text.slice(lastIndex, match.index),
          });
        }

        const nickname = String(match[1] || '').trim();
        const user = this.findMentionUser(nickname);
        if (user) {
          segments.push({
            type: 'mention',
            value: user.name,
            username: this.formatUsername(user.nickname),
            color: user.nicknameColor || null,
          });
        } else {
          segments.push({
            type: 'text',
            value: this.formatUsername(nickname),
          });
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        segments.push({
          type: 'text',
          value: text.slice(lastIndex),
        });
      }
    },

    buildMessageBodySegments(this: any, message: Message, sourceIndex: number) {
      const segments: Array<any> = [];
      let hiddenImageLink = false;

      for (const part of this.linkify(message.body)) {
        if (part.type === 'link') {
          const normalizedUrl = this.normalizeMessageLink(part.value);
          if (this.shouldHideImageLink(normalizedUrl)) {
            const preview = this.buildLinkPreview(normalizedUrl);
            if (preview?.type === 'image') {
              segments.push({
                type: 'inlineImagePreview',
                src: preview.src,
              });
            }
            hiddenImageLink = true;
            continue;
          }
          segments.push(part);
          continue;
        }

        let lastIndex = 0;
        TIME_TAG_RE.lastIndex = 0;
        for (const match of part.value.matchAll(TIME_TAG_RE)) {
          if (match.index === undefined) continue;
          if (match.index > lastIndex) {
            this.pushMentionSegments(segments, part.value.slice(lastIndex, match.index));
          }

          const timeLabel = match[1];
          const target = this.findClosestMessageByTime(sourceIndex, timeLabel);
          segments.push({
            type: 'timeTag',
            value: `[${timeLabel}]`,
            targetMessageId: target?.id || null,
            tooltip: target ? this.buildTimeTagTooltip(target) : 'Сообщение с этим временем не найдено',
          });
          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < part.value.length) {
          this.pushMentionSegments(segments, part.value.slice(lastIndex));
        }
      }

      if (segments.length) return segments;
      if (hiddenImageLink) return [];
      return [{type: 'text', value: message.body}];
    },

    scrollToMessageById(this: any, messageId: number) {
      if (!this.messagesEl) return;
      const target = this.messagesEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
      if (!target) return;
      target.scrollIntoView({behavior: 'smooth', block: 'center'});
      this.triggerMessageBlink(messageId);
    },

    onBodyTimeTagClick(this: any, segment: any) {
      if (!segment?.targetMessageId) return;
      this.timeTooltipVisible = false;
      this.scrollToMessageById(segment.targetMessageId);
    },

    parseUrl(this: any, raw: string) {
      try {
        return new URL(raw);
      } catch {
        return null;
      }
    },

    extractYouTubeId(this: any, url: URL) {
      const host = url.hostname.toLowerCase();
      if (host.includes('youtu.be')) {
        const id = url.pathname.split('/').filter(Boolean)[0] || '';
        return id || null;
      }
      if (!host.includes('youtube.com')) return null;

      if (url.pathname.startsWith('/watch')) {
        const id = url.searchParams.get('v') || '';
        return id || null;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        return parts[1] || null;
      }
      return null;
    },

    extractVkVideo(this: any, url: URL) {
      const host = url.hostname.toLowerCase();
      if (!host.includes('vkvideo.ru') && !host.includes('vk.com')) return null;

      const joined = `${url.pathname}${url.search}`;
      const match = joined.match(/video(-?\d+)_([0-9]+)/i);
      if (!match) return null;

      return {
        oid: match[1],
        id: match[2],
      };
    },

    buildLinkPreview(this: any, linkUrl: string): LinkPreview | null {
      const url = this.parseUrl(linkUrl);
      if (!url) return null;

      const path = url.pathname.toLowerCase();

      if (IMAGE_EXT_RE.test(path)) {
        return {
          key: `img:${linkUrl}`,
          type: 'image',
          src: linkUrl,
        };
      }

      if (VIDEO_EXT_RE.test(path)) {
        return {
          key: `video:${linkUrl}`,
          type: 'video',
          src: linkUrl,
        };
      }

      const youtubeId = this.extractYouTubeId(url);
      if (youtubeId) {
        return {
          key: `yt:${youtubeId}`,
          type: 'youtube',
          src: `https://www.youtube.com/embed/${youtubeId}`,
        };
      }

      const vkVideo = this.extractVkVideo(url);
      if (vkVideo) {
        return {
          key: `vk:${vkVideo.oid}_${vkVideo.id}`,
          type: 'embed',
          src: `https://vk.com/video_ext.php?oid=${vkVideo.oid}&id=${vkVideo.id}&hd=2`,
        };
      }

      return null;
    },

    extractMessageLinks(this: any, bodyRaw: string) {
      const body = String(bodyRaw || '');
      const matches = body.match(/https?:\/\/[^\s]+/gi) || [];
      return matches
        .map((url) => this.normalizeMessageLink(url))
        .filter(Boolean);
    },

    getMessagePreviews(this: any, message: Message) {
      const cacheKey = this.messagePreviewCacheKey(message);
      const cached = this.messagePreviewCache[cacheKey];
      if (cached) return cached;

      const previews: LinkPreview[] = [];
      const seen = new Set<string>();

      for (const linkUrl of this.extractMessageLinks(message.body)) {
        const preview = this.buildLinkPreview(linkUrl);
        if (!preview) continue;
        if (seen.has(preview.key)) continue;

        seen.add(preview.key);
        previews.push(preview);
      }

      this.messagePreviewCache = {
        ...this.messagePreviewCache,
        [cacheKey]: previews,
      };
      return previews;
    },

    getMessageExtraPreviews(this: any, message: Message) {
      return this.getMessagePreviews(message).filter((preview: LinkPreview) => preview.type !== 'image');
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

    onTimeTagMouseEnter(this: any, event: MouseEvent, segment: any) {
      const tooltip = String(segment?.tooltip || '').trim();
      if (!tooltip) return;
      this.timeTooltipText = tooltip;
      this.timeTooltipVisible = true;
      this.updateTimeTooltipPosition(event);
    },

    onTimeTagMouseMove(this: any, event: MouseEvent) {
      if (!this.timeTooltipVisible) return;
      this.updateTimeTooltipPosition(event);
    },

    onTimeTagMouseLeave(this: any) {
      this.timeTooltipVisible = false;
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

    applyMe(this: any, me: User) {
      this.me = me;
      this.profileName = me.name || me.nickname;
      this.profileNicknameColor = me.nicknameColor || '';
      this.profileColorPicker = me.nicknameColor || '#61afef';
    },

    async ensureAuth(this: any) {
      const session = await restoreSession();
      if (!(session as any)?.ok) {
        await this.router.push('/login');
        return false;
      }

      const me = await ws.request('auth:me');
      if (!(me as any)?.id) {
        await this.router.push('/login');
        return false;
      }

      this.applyMe(me as User);
      return true;
    },

    async fetchUsers(this: any) {
      const result = await ws.request('users:list');
      if (Array.isArray(result)) {
        this.users = result;
      }
    },

    async fetchDirectDialogs(this: any) {
      const result = await ws.request('dialogs:directs');
      if (Array.isArray(result)) {
        this.directDialogs = result;
      }
    },

    async fetchGeneralDialog(this: any) {
      const result = await ws.request('dialogs:general');
      if ((result as any)?.error || (result as any)?.ok === false) return null;
      return {
        id: (result as any).dialogId,
        kind: 'general',
        title: (result as any).title,
      } as Dialog;
    },

    async fetchPrivateDialog(this: any, user: User) {
      const result = await ws.request('dialogs:private', user.id);
      if ((result as any)?.error || (result as any)?.ok === false) {
        this.error = 'Не удалось открыть диалог.';
        return null;
      }
      return {
        id: (result as any).dialogId,
        kind: 'private',
        targetUser: (result as any).targetUser,
        title: (result as any).targetUser.name,
      } as Dialog;
    },

    async loadHistory(this: any, dialogId: number, seq: number) {
      if (seq === this.historyLoadSeq) {
        this.historyLoading = true;
      }
      try {
        const result = await ws.request('dialogs:messages', dialogId, 100);
        if (seq !== this.historyLoadSeq) return;
        if (!Array.isArray(result)) {
          this.error = 'Не удалось загрузить историю.';
          return;
        }
        this.messages = result.map((message: any) => this.normalizeMessage(message));
        await nextTick();
        this.scrollToBottom();
      } finally {
        if (seq === this.historyLoadSeq) {
          this.historyLoading = false;
        }
      }
    },

    async joinDialog(this: any, dialogId: number) {
      const result = await ws.request('chat:join', dialogId);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось подключиться к диалогу.';
      }
    },

    async selectDialog(this: any, dialog: Dialog) {
      const seq = this.historyLoadSeq + 1;
      this.historyLoadSeq = seq;
      this.activeDialog = dialog;
      this.messages = [];
      this.resetMessagePreviewCache();
      this.error = '';
      this.notificationsMenuOpen = false;
      await this.loadHistory(dialog.id, seq);
      await this.joinDialog(dialog.id);
    },

    async selectGeneral(this: any) {
      if (!this.generalDialog) return;
      await this.selectDialog(this.generalDialog);
      this.closeLeftMenu();
    },

    async onGoToGeneralChat(this: any) {
      await this.selectGeneral();
    },

    async selectPrivate(this: any, user: User) {
      const dialog = await this.fetchPrivateDialog(user);
      if (!dialog) return;
      await this.selectDialog(dialog);
      this.closeLeftMenu();
      await this.fetchDirectDialogs();
    },

    async selectUser(this: any, user: User) {
      await this.selectPrivate(user);
    },

    async selectDirectDialog(this: any, dialog: DirectDialog) {
      await this.selectDialog({
        id: dialog.dialogId,
        kind: 'private',
        targetUser: dialog.targetUser,
        title: dialog.targetUser.name,
      });
      this.closeLeftMenu();
    },

    async onDeleteActiveDirect(this: any) {
      if (this.activeDialog?.kind !== 'private') return;
      if (this.directDeletePending) return;
      if (!window.confirm('Удалить директ полностью? Это удалит всю переписку у обоих участников.')) return;

      this.directDeletePending = true;
      try {
        const dialogId = this.activeDialog.id;
        const result = await ws.request('dialogs:delete', dialogId);
        if (!(result as any)?.ok) {
          this.error = 'Не удалось удалить директ.';
          return;
        }
        await this.onDialogDeleted({dialogId});
      } finally {
        this.directDeletePending = false;
      }
    },

    toggleLeftMenu(this: any) {
      this.leftMenuOpen = !this.leftMenuOpen;
      if (this.leftMenuOpen) {
        this.rightMenuOpen = false;
        this.notificationsMenuOpen = false;
      }
    },

    closeLeftMenu(this: any) {
      this.leftMenuOpen = false;
    },

    toggleRightMenu(this: any) {
      this.rightMenuOpen = !this.rightMenuOpen;
      if (this.rightMenuOpen) {
        this.leftMenuOpen = false;
        this.notificationsMenuOpen = false;
      }
      this.profileError = '';
    },

    closeRightMenu(this: any) {
      this.rightMenuOpen = false;
    },

    clearNicknameColor(this: any) {
      this.profileNicknameColor = '';
      this.profileColorPicker = '#61afef';
    },

    onColorPicked(this: any) {
      this.profileNicknameColor = this.normalizeColor(this.profileColorPicker);
    },

    async onDone(this: any) {
      const name = this.profileName.trim();
      if (!name) {
        this.profileError = 'Имя не может быть пустым.';
        return;
      }

      const normalizedColor = this.normalizeColor(this.profileNicknameColor);
      if (normalizedColor && !COLOR_HEX_RE.test(normalizedColor)) {
        this.profileError = 'Цвет должен быть в формате #RRGGBB.';
        return;
      }

      this.profileSaving = true;
      this.profileError = '';

      try {
        const profileResult = await wsUpdateProfile({
          name,
          nicknameColor: normalizedColor || null,
        });

        if (!(profileResult as any)?.ok) {
          const code = (profileResult as any)?.error || 'unknown';
          if (code === 'unauthorized') {
            await this.router.push('/login');
            return;
          }
          this.profileError = 'Не удалось сохранить профиль.';
          return;
        }

        this.applyMe((profileResult as any).user as User);
        this.messages = this.messages.map((message: Message) => {
          if (message.authorId !== this.me?.id) return message;
          return {
            ...message,
            authorName: this.me!.name,
            authorNicknameColor: this.me!.nicknameColor,
          };
        });

        const nextPassword = this.newPassword.trim();
        if (nextPassword) {
          const passwordResult = await wsChangePassword(nextPassword);
          if (!(passwordResult as any)?.ok) {
            const code = (passwordResult as any)?.error || 'unknown';
            if (code === 'unauthorized') {
              await this.router.push('/login');
              return;
            }
            if (code === 'invalid_password') {
              this.profileError = 'Пароль слишком короткий.';
              return;
            }
            this.profileError = 'Не удалось сменить пароль.';
            return;
          }
        }

        this.newPassword = '';
        this.rightMenuOpen = false;
      } catch {
        this.profileError = 'Сервер недоступен.';
      } finally {
        this.profileSaving = false;
      }
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

      const text = String(textRaw || '').trim();
      if (!text) return false;

      const result = await ws.request('chat:send', this.activeDialog.id, text);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось отправить сообщение.';
        return false;
      }

      this.forceOwnScrollDown = true;
      this.scrollToBottom();
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

    onKeydown(this: any, event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      void this.onSend();
    },

    async onLogout(this: any) {
      this.error = '';
      await wsLogout();
      await this.router.push('/login');
    },

    isNearBottom(this: any) {
      if (!this.messagesEl) return true;
      const threshold = 30;
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
      this.updateScrollDownVisibility();
    },

    onScrollDownClick(this: any) {
      this.scrollToBottom('smooth');
    },

    scrollToBottom(this: any, behavior: ScrollBehavior = 'auto') {
      if (!this.messagesEl) return;
      this.messagesEl.scrollTo({
        top: this.messagesEl.scrollHeight,
        behavior,
      });
      this.showScrollDown = false;
    },

    async onChatMessage(this: any, message: Message) {
      const ownMessage = message.authorId === this.me?.id;
      const isCurrentDialogMessage = this.activeDialog?.id === message.dialogId;

      if (!isCurrentDialogMessage) {
        if (!ownMessage) {
          this.addNotificationFromMessage(message);
        }
        await this.fetchDirectDialogs();
        return;
      }

      if (!ownMessage && this.isWindowInactive()) {
        this.inactiveTabUnread = true;
        this.updateFaviconBlinkByUnread();
      }

      const shouldAutoScroll = this.isNearBottom() || (ownMessage && this.forceOwnScrollDown);
      this.messages.push(this.normalizeMessage(message));
      await nextTick();
      if (shouldAutoScroll) {
        this.scrollToBottom();
      } else {
        this.updateScrollDownVisibility();
      }
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
      this.cancelMessageEdit();
      this.reactionPickerMessageId = null;
      this.reactionTooltipVisible = false;
      this.resetMessagePreviewCache();

      if (this.generalDialog) {
        await this.selectDialog(this.generalDialog);
      } else {
        this.activeDialog = null;
      }
      await this.fetchDirectDialogs();
    },

    onDisconnected(this: any) {
      this.error = 'Соединение потеряно. Перезайди в чат.';
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
      this.leftMenuOpen = !this.isCompactLayout;
    },

    onWindowResize(this: any) {
      const nextCompact = window.innerWidth < 1100;
      if (nextCompact === this.isCompactLayout) return;
      this.isCompactLayout = nextCompact;
      if (nextCompact) {
        this.leftMenuOpen = false;
        this.rightMenuOpen = false;
        return;
      }

      this.leftMenuOpen = true;
      this.rightMenuOpen = false;
    },

    onWindowFocus(this: any) {
      this.windowFocused = true;
      if (this.documentVisible) {
        this.clearInactiveTabUnread();
      }
    },

    onWindowBlur(this: any) {
      this.windowFocused = false;
    },

    onVisibilityChange(this: any) {
      this.documentVisible = !document.hidden;
      if (this.documentVisible && this.windowFocused) {
        this.clearInactiveTabUnread();
      }
    },
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;

    this.chatMessageHandler = (message: Message) => {
      void this.onChatMessage(message);
    };
    this.chatMessageUpdatedHandler = (message: Message) => {
      this.onChatMessageUpdated(message);
    };
    this.chatMessageDeletedHandler = (payload: any) => {
      void this.onChatMessageDeleted(payload);
    };
    this.chatReactionsHandler = (payload: any) => {
      this.onChatReactions(payload);
    };
    this.dialogsDeletedHandler = (payload: any) => {
      void this.onDialogDeleted(payload);
    };
    this.chatReactionNotifyHandler = (payload: any) => {
      this.onChatReactionNotify(payload);
    };
    this.disconnectedHandler = () => this.onDisconnected();
    this.windowKeydownHandler = (event: KeyboardEvent) => this.onWindowKeydown(event);
    this.windowResizeHandler = () => this.onWindowResize();
    this.windowClickHandler = (event: MouseEvent) => this.onWindowClick(event);
    this.windowFocusHandler = () => this.onWindowFocus();
    this.windowBlurHandler = () => this.onWindowBlur();
    this.visibilityChangeHandler = () => this.onVisibilityChange();

    on('chat:message', this.chatMessageHandler);
    on('chat:message-updated', this.chatMessageUpdatedHandler);
    on('chat:message-deleted', this.chatMessageDeletedHandler);
    on('chat:reactions', this.chatReactionsHandler);
    on('dialogs:deleted', this.dialogsDeletedHandler);
    on('chat:reaction-notify', this.chatReactionNotifyHandler);
    on('ws:disconnected', this.disconnectedHandler);
    window.addEventListener('keydown', this.windowKeydownHandler);
    window.addEventListener('resize', this.windowResizeHandler);
    window.addEventListener('click', this.windowClickHandler);
    window.addEventListener('focus', this.windowFocusHandler);
    window.addEventListener('blur', this.windowBlurHandler);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);

    this.initLayout();
    this.windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
    this.documentVisible = typeof document !== 'undefined' ? !document.hidden : true;
    this.stopFaviconBlink();
    this.generalDialog = await this.fetchGeneralDialog();
    await this.fetchUsers();
    await this.fetchDirectDialogs();

    if (this.generalDialog) {
      await this.selectDialog(this.generalDialog);
    }
  },

  beforeUnmount(this: any) {
    this.chatMessageHandler && off('chat:message', this.chatMessageHandler);
    this.chatMessageUpdatedHandler && off('chat:message-updated', this.chatMessageUpdatedHandler);
    this.chatMessageDeletedHandler && off('chat:message-deleted', this.chatMessageDeletedHandler);
    this.chatReactionsHandler && off('chat:reactions', this.chatReactionsHandler);
    this.dialogsDeletedHandler && off('dialogs:deleted', this.dialogsDeletedHandler);
    this.chatReactionNotifyHandler && off('chat:reaction-notify', this.chatReactionNotifyHandler);
    this.disconnectedHandler && off('ws:disconnected', this.disconnectedHandler);
    this.windowKeydownHandler && window.removeEventListener('keydown', this.windowKeydownHandler);
    this.windowResizeHandler && window.removeEventListener('resize', this.windowResizeHandler);
    this.windowClickHandler && window.removeEventListener('click', this.windowClickHandler);
    this.windowFocusHandler && window.removeEventListener('focus', this.windowFocusHandler);
    this.windowBlurHandler && window.removeEventListener('blur', this.windowBlurHandler);
    this.visibilityChangeHandler && document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
    this.stopFaviconBlink();
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    Object.values(this.toastTimerById).forEach((timerId: number) => clearTimeout(timerId));
    this.toastTimerById = {};
  },
};
