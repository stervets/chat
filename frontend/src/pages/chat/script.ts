import type {Message, User} from '@/composables/types';
import {on, off} from '@/composables/event-bus';
import {setWsReconnectDialogResolver} from '@/composables/ws-rpc';
import ChatMessageItem from './message-item/index.vue';
import {
  VIRTUAL_MAX_ITEMS,
  type DirectDialog,
  type NotificationItem,
} from './chat-page.constants';
import {createChatPageState} from './chat-page.state';
import {chatMethodsRuntimeAndRouting} from './modules/methods-runtime-and-routing';
import {chatMethodsComposerAndVirtual} from './modules/methods-composer-and-virtual';
import {chatMethodsNotifications} from './modules/methods-notifications';
import {chatMethodsMessageBodyAndReactions} from './modules/methods-message-body-and-reactions';
import {chatMethodsAuthDialogsAndProfile} from './modules/methods-auth-dialogs-and-profile';
import {chatMethodsSendUploadAndRuntime} from './modules/methods-send-upload-and-runtime';

export default {
  components: {
    ChatMessageItem,
  },

  async setup() {
    return {
      router: useRouter(),
      route: useRoute(),
      ...createChatPageState(),
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

    wsOffline(this: any) {
      return this.wsConnectionState !== 'connected';
    },

    wsStatusText(this: any) {
      if (this.wsConnectionState === 'connecting') return 'connecting...';
      if (this.wsConnectionState === 'disconnected') return 'offline';
      return '';
    },

    unreadDirectDialogIds(this: any) {
      const ids: Record<number, true> = {};
      this.notifications.forEach((notification: NotificationItem) => {
        if (!notification.unread) return;
        if (notification.notificationType !== 'message') return;
        if (notification.dialogKind !== 'private') return;
        const dialogId = Number(notification.dialogId || 0);
        if (!Number.isFinite(dialogId) || dialogId <= 0) return;
        ids[dialogId] = true;
      });
      return ids;
    },

    sortedDirectDialogs(this: any) {
      const unreadIds = this.unreadDirectDialogIds || {};
      return [...this.directDialogs].sort((left: DirectDialog, right: DirectDialog) => {
        const leftUnread = !!unreadIds[left.dialogId];
        const rightUnread = !!unreadIds[right.dialogId];
        if (leftUnread !== rightUnread) return leftUnread ? -1 : 1;

        const leftTs = Date.parse(String(left.lastMessageAt || ''));
        const rightTs = Date.parse(String(right.lastMessageAt || ''));
        const leftTime = Number.isFinite(leftTs) ? leftTs : 0;
        const rightTime = Number.isFinite(rightTs) ? rightTs : 0;
        if (leftTime !== rightTime) return rightTime - leftTime;

        return Number(right.dialogId || 0) - Number(left.dialogId || 0);
      });
    },

    virtualMessages(this: any) {
      if (!this.messages.length) return [];
      const start = Math.max(0, Number(this.virtualRangeStart || 0));
      const configuredEnd = Math.max(start, Number(this.virtualRangeEnd || 0));
      const end = configuredEnd > start
        ? configuredEnd
        : Math.min(this.messages.length, start + VIRTUAL_MAX_ITEMS);
      return this.messages.slice(start, end).map((message: Message, index: number) => ({
        message,
        sourceIndex: start + index,
      }));
    },

    virtualTopSpacerHeight(this: any) {
      const start = Math.max(0, Number(this.virtualRangeStart || 0));
      const prefix = Array.isArray(this.virtualPrefixHeights) ? this.virtualPrefixHeights : [];
      if (start <= 0 || start >= prefix.length) return 0;
      return Math.max(0, Number(prefix[start] || 0));
    },

    virtualBottomSpacerHeight(this: any) {
      const end = Math.max(0, Number(this.virtualRangeEnd || 0));
      const prefix = Array.isArray(this.virtualPrefixHeights) ? this.virtualPrefixHeights : [];
      const total = Math.max(0, Number(this.virtualTotalHeight || 0));
      if (!prefix.length || end >= prefix.length) return 0;
      return Math.max(0, total - Number(prefix[end] || 0));
    },
  },

  watch: {
    'route.fullPath'(this: any) {
      if (!this.routeSyncReady) return;
      void this.onRouteChanged();
    },
  },

  methods: {
    ...chatMethodsRuntimeAndRouting,
    ...chatMethodsComposerAndVirtual,
    ...chatMethodsNotifications,
    ...chatMethodsMessageBodyAndReactions,
    ...chatMethodsAuthDialogsAndProfile,
    ...chatMethodsSendUploadAndRuntime,
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;
    setWsReconnectDialogResolver(() => {
      const dialogId = Number(this.activeDialog?.id || 0);
      return Number.isFinite(dialogId) && dialogId > 0 ? dialogId : null;
    });
    this.resolveSoundStartupState();
    this.initBrowserNotifications();

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
    this.usersUpdatedHandler = (user: User) => {
      this.onUsersUpdated(user);
    };
    this.disconnectedHandler = () => this.onDisconnected();
    this.reconnectedHandler = () => {
      void this.onWsReconnected();
    };
    this.sessionExpiredHandler = () => {
      void this.onWsSessionExpired();
    };
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
    on('users:updated', this.usersUpdatedHandler);
    on('ws:disconnected', this.disconnectedHandler);
    on('ws:reconnected', this.reconnectedHandler);
    on('ws:session-expired', this.sessionExpiredHandler);
    window.addEventListener('keydown', this.windowKeydownHandler);
    window.addEventListener('resize', this.windowResizeHandler);
    window.addEventListener('click', this.windowClickHandler);
    window.addEventListener('focus', this.windowFocusHandler);
    window.addEventListener('blur', this.windowBlurHandler);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);

    this.initLayout();
    this.windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
    this.documentVisible = typeof document !== 'undefined' ? !document.hidden : true;
    this.badgeNowTs = Date.now();
    this.badgeTickTimer = window.setInterval(() => {
      this.badgeNowTs = Date.now();
    }, 60 * 1000);
    this.stopFaviconBlink();
    this.generalDialog = await this.fetchGeneralDialog();
    await this.fetchUsers();
    await this.fetchDirectDialogs();

    await this.syncDialogFromRoute({replaceInvalid: true});
    this.routeSyncReady = true;
    this.scheduleVirtualSync();
  },

  beforeUnmount(this: any) {
    this.chatMessageHandler && off('chat:message', this.chatMessageHandler);
    this.chatMessageUpdatedHandler && off('chat:message-updated', this.chatMessageUpdatedHandler);
    this.chatMessageDeletedHandler && off('chat:message-deleted', this.chatMessageDeletedHandler);
    this.chatReactionsHandler && off('chat:reactions', this.chatReactionsHandler);
    this.dialogsDeletedHandler && off('dialogs:deleted', this.dialogsDeletedHandler);
    this.chatReactionNotifyHandler && off('chat:reaction-notify', this.chatReactionNotifyHandler);
    this.usersUpdatedHandler && off('users:updated', this.usersUpdatedHandler);
    this.disconnectedHandler && off('ws:disconnected', this.disconnectedHandler);
    this.reconnectedHandler && off('ws:reconnected', this.reconnectedHandler);
    this.sessionExpiredHandler && off('ws:session-expired', this.sessionExpiredHandler);
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
    Object.values(this.toastTimerById as Record<number, number>).forEach((timerId) => {
      clearTimeout(Number(timerId));
    });
    this.toastTimerById = {};
    if (this.handledMessageNotificationSaveTimer) {
      clearTimeout(this.handledMessageNotificationSaveTimer);
      this.handledMessageNotificationSaveTimer = null;
    }
    if (this.notificationAudioEl) {
      this.notificationAudioEl.pause();
      this.notificationAudioEl.currentTime = 0;
      this.notificationAudioEl = null;
    }
    if (this.badgeTickTimer) {
      clearInterval(this.badgeTickTimer);
      this.badgeTickTimer = null;
    }
    if (Array.isArray(this.activeBrowserNotifications) && this.activeBrowserNotifications.length) {
      this.activeBrowserNotifications.forEach((item: Notification) => item.close());
      this.activeBrowserNotifications = [];
    }
    setWsReconnectDialogResolver(null);
    this.persistHandledMessageNotificationIds();
  },
};
