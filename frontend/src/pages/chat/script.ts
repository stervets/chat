import type {Message, User} from '@/composables/types';
import {on, off} from '@/composables/event-bus';
import {setWsReconnectDialogResolver} from '@/composables/ws-rpc';
import {isStandaloneDisplayMode} from '@/composables/use-web-push';
import ChatMessageItem from './message-item/index.vue';
import ScriptableMessage from './message-scriptable/index.vue';
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
import {chatMethodsScriptableRuntime} from './modules/methods-scriptable-runtime';

export default {
  components: {
    ChatMessageItem,
    ScriptableMessage,
  },

  async setup() {
    const runtimeConfig = useRuntimeConfig();
    return {
      router: useRouter(),
      route: useRoute(),
      appMode: String(runtimeConfig.public.mode || '').trim().toLowerCase(),
      ...createChatPageState(),
    };
  },

  computed: {
    isDevMode(this: any) {
      return this.appMode === 'dev';
    },

    isStandaloneApp(this: any) {
      if (typeof window === 'undefined') return false;
      return isStandaloneDisplayMode();
    },

    filteredUsers(this: any) {
      const query = this.searchQuery.trim().toLowerCase().replace(/^@+/, '');
      if (!query) return [];
      const matched = this.users
        .map((user: User) => {
          const name = String(user.name || '').toLowerCase();
          const nickname = String(user.nickname || '').toLowerCase();
          const byName = name.includes(query);
          const byNickname = nickname.includes(query);
          if (!byName && !byNickname) return null;

          let score = 0;
          if (nickname === query) score += 120;
          if (name === query) score += 100;
          if (nickname.startsWith(query)) score += 60;
          if (name.startsWith(query)) score += 50;
          if (byNickname) score += 20;
          if (byName) score += 10;

          return {user, score};
        })
        .filter(Boolean) as Array<{user: User; score: number}>;

      matched.sort((left, right) => {
        if (left.score !== right.score) return right.score - left.score;
        return Number(left.user.id || 0) - Number(right.user.id || 0);
      });
      return matched.map((item) => item.user);
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

    webPushStatusText(this: any) {
      if (!this.webPushSupported) return 'не поддерживается';
      if (!this.webPushAvailable) return 'backend /push/public-key отключен или недоступен';
      if (this.isStandaloneApp && !this.webPushSettingEnabled) return 'выключено';
      if (this.webPushPermission === 'denied') return 'запрещено в браузере';
      if (this.webPushEnabled) return 'включено';
      if (this.webPushPermission === 'granted' && !this.webPushSynced) {
        return 'разрешено, но подписка не синхронизирована с сервером';
      }
      if (this.webPushPermission === 'granted') return 'готово к включению';
      return 'не включено';
    },

    canSendWebPushTest(this: any) {
      if (this.webPushEnabled) return true;
      return this.webPushSupported && this.webPushPermission === 'granted';
    },

    unreadDirectDialogIds(this: any) {
      const ids: Record<number, true> = {};
      this.notifications.forEach((notification: NotificationItem) => {
        if (!notification.unread) return;
        if (notification.notificationType !== 'message') return;
        if (notification.roomKind !== 'direct') return;
        const roomId = Number(notification.roomId || 0);
        if (!Number.isFinite(roomId) || roomId <= 0) return;
        ids[roomId] = true;
      });
      return ids;
    },

    sortedDirectDialogs(this: any) {
      const unreadIds = this.unreadDirectDialogIds || {};
      return [...this.directDialogs].sort((left: DirectDialog, right: DirectDialog) => {
        const leftUnread = !!unreadIds[left.roomId];
        const rightUnread = !!unreadIds[right.roomId];
        if (leftUnread !== rightUnread) return leftUnread ? -1 : 1;

        const leftTs = Date.parse(String(left.lastMessageAt || ''));
        const rightTs = Date.parse(String(right.lastMessageAt || ''));
        const leftTime = Number.isFinite(leftTs) ? leftTs : 0;
        const rightTime = Number.isFinite(rightTs) ? rightTs : 0;
        if (leftTime !== rightTime) return rightTime - leftTime;

        return Number(right.roomId || 0) - Number(left.roomId || 0);
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

    isActiveDialogAdmin(this: any) {
      if (!this.activeDialog || !this.me?.id) return false;
      if (this.activeDialog.kind === 'direct') return false;
      return Number(this.activeDialog.createdById || 0) > 0
        && Number(this.activeDialog.createdById) === Number(this.me.id);
    },

    canManagePinnedMessages(this: any) {
      if (!this.activeDialog) return false;
      if (this.activeDialog.kind === 'direct') return false;
      return !!this.isActiveDialogAdmin;
    },

    canDeleteActiveRoom(this: any) {
      if (!this.activeDialog) return false;
      if (this.activeDialog.kind === 'direct') return true;
      return !!this.isActiveDialogAdmin;
    },

    shouldShowPinnedPanel(this: any) {
      if (!this.activeDialog || !this.activePinnedMessage) return false;
      if (this.activeDialog.kind === 'direct') return false;
      return true;
    },

    pinnedPanelStyle(this: any) {
      if (!this.shouldShowPinnedPanel || this.pinnedCollapsed) return {};
      const ratio = this.clampPinnedPanelHeightRatio(this.pinnedPanelHeightRatio);
      return {
        height: `${(ratio * 100).toFixed(2)}%`,
      };
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
    ...chatMethodsScriptableRuntime,
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;
    setWsReconnectDialogResolver(() => {
      const roomId = Number(this.activeDialog?.id || 0);
      return Number.isFinite(roomId) && roomId > 0 ? roomId : null;
    });
    this.resolveSoundStartupState();
    this.initScriptRuntimeManager();
    this.initBrowserNotifications();
    await this.initWebPush();

    this.chatMessageHandler = (message: Message) => {
      void this.onChatMessage(message);
    };
    this.chatMessageUpdatedHandler = (message: Message) => {
      this.onChatMessageUpdated(message);
    };
    this.chatMessageDeletedHandler = (payload: any) => {
      void this.onChatMessageDeleted(payload);
    };
    this.chatPinnedHandler = (payload: any) => {
      this.onChatPinned(payload);
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
    this.scriptsStateHandler = (payload: any) => {
      this.onScriptsState(payload);
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
    on('chat:pinned', this.chatPinnedHandler);
    on('chat:reactions', this.chatReactionsHandler);
    on('dialogs:deleted', this.dialogsDeletedHandler);
    on('chat:reaction-notify', this.chatReactionNotifyHandler);
    on('users:updated', this.usersUpdatedHandler);
    on('scripts:state', this.scriptsStateHandler);
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
    this.loadPinnedPanelLayoutState();
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
    this.chatPinnedHandler && off('chat:pinned', this.chatPinnedHandler);
    this.chatReactionsHandler && off('chat:reactions', this.chatReactionsHandler);
    this.dialogsDeletedHandler && off('dialogs:deleted', this.dialogsDeletedHandler);
    this.chatReactionNotifyHandler && off('chat:reaction-notify', this.chatReactionNotifyHandler);
    this.usersUpdatedHandler && off('users:updated', this.usersUpdatedHandler);
    this.scriptsStateHandler && off('scripts:state', this.scriptsStateHandler);
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
    this.clearFreshMessageMarks();
    this.closeImageViewer();
    if (Array.isArray(this.activeBrowserNotifications) && this.activeBrowserNotifications.length) {
      this.activeBrowserNotifications.forEach((item: Notification) => item.close());
      this.activeBrowserNotifications = [];
    }
    setWsReconnectDialogResolver(null);
    this.persistHandledMessageNotificationIds();
    this.stopPinnedSplitterDrag();
    this.disposeScriptRuntimeManager();
  },
};
