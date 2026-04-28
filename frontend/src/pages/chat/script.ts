import type {Message, User} from '@/composables/types';
import {on, off} from '@/composables/event-bus';
import {setWsReconnectDialogResolver} from '@/composables/ws-rpc';
import {isStandaloneDisplayMode} from '@/composables/use-web-push';
import ChatHeader from './components/chat-header/index.vue';
import ChatLeftDrawer from './components/chat-left-drawer/index.vue';
import ChatToasts from './components/chat-toasts/index.vue';
import RoomInvitePanel from './components/room-invite-panel/index.vue';
import PinnedPanel from './components/pinned-panel/index.vue';
import ChatMessageFeed from './components/chat-message-feed/index.vue';
import ChatComposer from './components/chat-composer/index.vue';
import ChatImageViewer from './components/chat-image-viewer/index.vue';
import ChatCallOverlay from './components/chat-call-overlay/index.vue';
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
import {chatMethodsCalls} from './modules/methods-calls';

export default {
  components: {
    ChatLeftDrawer,
    ChatToasts,
    RoomInvitePanel,
    PinnedPanel,
    ChatMessageFeed,
    ChatComposer,
    ChatImageViewer,
    ChatCallOverlay,
    ChatHeader,
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

    filteredDirectDialogs(this: any) {
      const query = this.searchQuery.trim().toLowerCase().replace(/^@+/, '');
      if (!query) return this.sortedDirectDialogs;
      return this.sortedDirectDialogs.filter((dialog: DirectDialog) => {
        const name = String(dialog?.targetUser?.name || '').toLowerCase();
        const nickname = String(dialog?.targetUser?.nickname || '').toLowerCase();
        return name.includes(query) || nickname.includes(query);
      });
    },

    filteredJoinedRooms(this: any) {
      const query = this.roomSearchQuery.trim().toLowerCase();
      if (!query) return this.joinedRooms;
      return this.joinedRooms.filter((dialog: any) => {
        const title = String(dialog?.title || '').toLowerCase();
        return title.includes(query);
      });
    },

    filteredPublicRooms(this: any) {
      const query = this.roomSearchQuery.trim().toLowerCase();
      if (!query) return this.publicRooms;
      return this.publicRooms.filter((dialog: any) => {
        const title = String(dialog?.title || '').toLowerCase();
        return title.includes(query);
      });
    },

    filteredRoomInviteContacts(this: any) {
      const query = this.roomInviteSearchQuery.trim().toLowerCase().replace(/^@+/, '');
      if (!query) return this.roomInviteContacts;
      return this.roomInviteContacts.filter((user: User) => {
        const name = String(user?.name || '').toLowerCase();
        const nickname = String(user?.nickname || '').toLowerCase();
        return name.includes(query) || nickname.includes(query);
      });
    },

    filteredRoomInviteUsers(this: any) {
      const query = this.roomInviteSearchQuery.trim().toLowerCase().replace(/^@+/, '');
      if (!query) return [];
      const contactIds = new Set(this.roomInviteContacts.map((user: User) => Number(user.id || 0)));
      return this.users.filter((user: User) => {
        if (contactIds.has(Number(user.id || 0))) return false;
        const name = String(user?.name || '').toLowerCase();
        const nickname = String(user?.nickname || '').toLowerCase();
        return name.includes(query) || nickname.includes(query);
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
      const pinnedIds = new Set((this.pinnedDirectUserIds || []).map((value: number) => Number(value || 0)));
      const visibleDirectDialogs = (this.directDialogs || []).filter((dialog: DirectDialog) => {
        const targetUserId = Number(dialog?.targetUser?.id || 0);
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) return false;

        const lastMessageTs = Date.parse(String(dialog?.lastMessageAt || ''));
        const hasMessages = Number.isFinite(lastMessageTs) && lastMessageTs > 0;
        if (hasMessages) return true;

        return pinnedIds.has(targetUserId);
      });
      const dialogsByUserId = new Set(
        visibleDirectDialogs
          .map((dialog: DirectDialog) => Number(dialog?.targetUser?.id || 0))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      );
      const syntheticPinnedDialogs: DirectDialog[] = [];
      pinnedIds.forEach((userIdRaw: number) => {
        const userId = Number(userIdRaw || 0);
        if (!Number.isFinite(userId) || userId <= 0) return;
        if (dialogsByUserId.has(userId)) return;

        const targetUser = this.users.find((user: User) => Number(user?.id || 0) === userId);
        if (!targetUser) return;

        syntheticPinnedDialogs.push({
          roomId: -userId,
          targetUser,
          lastMessageAt: '',
        });
      });

      return [...visibleDirectDialogs, ...syntheticPinnedDialogs].sort((left: DirectDialog, right: DirectDialog) => {
        const leftUnread = !!unreadIds[left.roomId];
        const rightUnread = !!unreadIds[right.roomId];
        if (leftUnread !== rightUnread) return leftUnread ? -1 : 1;

        const leftOnline = !!left?.targetUser?.isOnline;
        const rightOnline = !!right?.targetUser?.isOnline;
        if (leftOnline !== rightOnline) return leftOnline ? -1 : 1;

        const leftName = String(left?.targetUser?.name || left?.targetUser?.nickname || '').trim().toLowerCase();
        const rightName = String(right?.targetUser?.name || right?.targetUser?.nickname || '').trim().toLowerCase();
        if (leftName !== rightName) return leftName.localeCompare(rightName);

        const leftNickname = String(left?.targetUser?.nickname || '').trim().toLowerCase();
        const rightNickname = String(right?.targetUser?.nickname || '').trim().toLowerCase();
        if (leftNickname !== rightNickname) return leftNickname.localeCompare(rightNickname);

        return Number(left?.targetUser?.id || 0) - Number(right?.targetUser?.id || 0);
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

    isGeneralDialogActive(this: any) {
      const activeId = Number(this.activeDialog?.id || 0);
      const generalId = Number(this.generalDialog?.id || 0);
      if (!Number.isFinite(activeId) || activeId <= 0) return false;
      if (!Number.isFinite(generalId) || generalId <= 0) return false;
      return activeId === generalId;
    },

    canManagePinnedMessages(this: any) {
      if (!this.activeDialog || this.activeDialog.kind === 'direct') return false;
      const discussionSourceMessageId = Number(this.activeDialog?.discussion?.sourceMessageId || 0);
      const activePinnedId = Number(this.activePinnedMessage?.id || 0);
      const roomPinnedNodeId = Number(this.activeDialog?.pinnedNodeId || 0);
      const isDiscussionSyntheticPinned = discussionSourceMessageId > 0
        && activePinnedId === discussionSourceMessageId
        && roomPinnedNodeId <= 0;
      if (isDiscussionSyntheticPinned) return false;
      return !!this.isActiveDialogAdmin;
    },

    isActiveDirectPinned(this: any) {
      if (this.activeDialog?.kind !== 'direct') return false;
      const targetUserId = Number(this.activeDialog?.targetUser?.id || 0);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) return false;
      return (this.pinnedDirectUserIds || []).includes(targetUserId);
    },

    isActiveRoomPinned(this: any) {
      if (!this.activeDialog || this.activeDialog.kind === 'direct') return false;
      return !!this.activeDialog?.joined;
    },

    canPinActiveDialog(this: any) {
      if (!this.activeDialog) return false;
      if (this.activeDialog.kind === 'direct') {
        return !this.isActiveDirectPinned;
      }
      return !this.isActiveRoomPinned;
    },

    canDeleteActiveRoom(this: any) {
      if (!this.activeDialog) return false;
      if (this.activeDialog.kind === 'direct') {
        return !this.isSystemNickname(this.activeDialog?.targetUser?.nickname);
      }
      return !!this.isActiveDialogAdmin;
    },

    canComposeInActiveDialog(this: any) {
      if (!this.activeDialog) return false;
      if (this.activeDialog.kind === 'direct') return true;
      if (!this.activeDialog.postOnlyByAdmin) return true;
      return !!this.isActiveDialogAdmin;
    },

    canStartCall(this: any) {
      if (!this.activeDialog || this.activeDialog.kind !== 'direct') return false;
      if (this.isSystemNickname(this.activeDialog?.targetUser?.nickname)) return false;
      return true;
    },

    callButtonDisabled(this: any) {
      return this.wsOffline || (this.callPhase !== 'idle' && this.callPhase !== 'ended');
    },

    callPeerName(this: any) {
      const user = this.getCallPeerUser?.(this.activeCall) || this.activeDialog?.targetUser || null;
      return String(user?.name || user?.nickname || 'Собеседник').trim() || 'Собеседник';
    },

    callPeerAvatarUrl(this: any) {
      const user = this.getCallPeerUser?.(this.activeCall) || this.activeDialog?.targetUser || null;
      return String(user?.avatarUrl || '');
    },

    callDurationText(this: any) {
      const startedAt = Number(this.callStartedAt || 0);
      if (!startedAt) return '00:00';
      const elapsed = Math.max(0, Math.floor((Number(this.callDurationNow || Date.now()) - startedAt) / 1000));
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
      return minutes + ':' + seconds;
    },
    activeRoomSurface(this: any) {
      const fallbackSurfaceId = Number(this.activePinnedMessage?.id || this.activeDialog?.pinnedNodeId || 0) || null;
      return this.normalizeRoomSurface(this.activeDialog?.roomSurface, fallbackSurfaceId);
    },

    isRoomSurfaceEnabled(this: any) {
      return !!this.activeDialog && this.activeDialog.kind !== 'direct' && !!this.activeRoomSurface?.enabled;
    },

    activeRoomSurfaceTypeLabel(this: any) {
      const appType = String(this.activeRoomSurface?.type || '').trim().toLowerCase();
      if (appType === 'llm') return 'LLM room';
      if (appType === 'poll') return 'Poll room';
      if (appType === 'dashboard') return 'Dashboard room';
      if (appType === 'bot_control') return 'Bot control';
      if (appType === 'custom') return 'Custom surface';
      return 'Surface room';
    },

    isPinnedRoomSurface(this: any) {
      if (!this.isRoomSurfaceEnabled) return false;
      return this.activePinnedMessage?.kind === 'scriptable';
    },

    shouldShowRoomSurfacePlaceholder(this: any) {
      if (!this.isRoomSurfaceEnabled) return false;
      return !this.activePinnedMessage;
    },

    shouldShowPinnedPanel(this: any) {
      if (!this.activeDialog || !this.activePinnedMessage) return false;
      return true;
    },

    pinnedPanelStyle(this: any) {
      if (!this.shouldShowPinnedPanel || this.pinnedCollapsed) return {};
      const ratio = this.clampPinnedPanelHeightRatio(this.pinnedPanelHeightRatio);
      return {
        height: `${(ratio * 100).toFixed(2)}%`,
      };
    },

    activeDiscussionMeta(this: any) {
      const raw = this.activeDialog?.discussion;
      if (!raw || typeof raw !== 'object') return null;
      return raw;
    },

    isDiscussionRoom(this: any) {
      return !!this.activeDiscussionMeta;
    },

    activeDiscussionSourceDeleted(this: any) {
      if (!this.activeDiscussionMeta) return false;
      return !!this.activeDiscussionMeta.sourceMessageDeleted;
    },

    canBackToDiscussionSource(this: any) {
      if (!this.activeDiscussionMeta) return false;
      if (this.activeDiscussionSourceDeleted) return false;
      const sourceRoomId = Number(this.activeDiscussionMeta.sourceRoomId || 0);
      return Number.isFinite(sourceRoomId) && sourceRoomId > 0;
    },
  },

  watch: {
    'route.fullPath'(this: any) {
      if (!this.routeSyncReady) return;
      void (async () => {
        await this.onRouteChanged();
        await this.handleCallRouteIntent();
      })();
    },
  },

  methods: {
    setPageRef(this: any, name: string, el: any) {
      this[name] = el || null;
    },

    onWsDisconnectedWithCall(this: any) {
      this.onDisconnected();
      this.onCallWsDisconnected();
    },

    ...chatMethodsRuntimeAndRouting,
    ...chatMethodsComposerAndVirtual,
    ...chatMethodsNotifications,
    ...chatMethodsMessageBodyAndReactions,
    ...chatMethodsAuthDialogsAndProfile,
    ...chatMethodsSendUploadAndRuntime,
    ...chatMethodsScriptableRuntime,
    ...chatMethodsCalls,
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;
    setWsReconnectDialogResolver(() => {
      const roomId = Number(this.activeDialog?.id || 0);
      return Number.isFinite(roomId) && roomId > 0 ? roomId : null;
    });
    this.resolveSoundStartupState();
    this.initBrowserNotifications();
    await this.initWebPush();

    on('message:created', this.onChatMessage);
    on('message:updated', this.onChatMessageUpdated);
    on('message:deleted', this.onChatMessageDeleted);
    on('room:pin:updated', this.onChatPinned);
    on('room:updated', this.onChatRoomUpdated);
    on('message:reactions:updated', this.onChatReactions);
    on('room:deleted', this.onDialogDeleted);
    on('room:messages:cleared', this.onRoomMessagesCleared);
    on('message:reaction:notify', this.onChatReactionNotify);
    on('message:comment:notify', this.addCommentNotification);
    on('contacts:updated', this.fetchPinnedDirectUserIds);
    on('user:updated', this.onUsersUpdated);
    on('call:incoming', this.onCallIncoming);
    on('call:accepted', this.onCallAccepted);
    on('call:ended', this.onCallEnded);
    on('call:signal', this.onCallSignal);
    on('ws:disconnected', this.onWsDisconnectedWithCall);
    on('ws:reconnected', this.onWsReconnected);
    on('ws:session-expired', this.onWsSessionExpired);

    window.addEventListener('keydown', this.onWindowKeydown);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('click', this.onWindowClick);
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

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
    await this.fetchPinnedDirectUserIds();
    await this.fetchRoomsNavigation();

    await this.syncDialogFromRoute({replaceInvalid: true});
    this.routeSyncReady = true;
    await this.onRouteChanged();
    await this.handleCallRouteIntent();
    this.scheduleVirtualSync();
  },

  beforeUnmount(this: any) {
    off('message:created', this.onChatMessage);
    off('message:updated', this.onChatMessageUpdated);
    off('message:deleted', this.onChatMessageDeleted);
    off('room:pin:updated', this.onChatPinned);
    off('room:updated', this.onChatRoomUpdated);
    off('message:reactions:updated', this.onChatReactions);
    off('room:deleted', this.onDialogDeleted);
    off('room:messages:cleared', this.onRoomMessagesCleared);
    off('message:reaction:notify', this.onChatReactionNotify);
    off('message:comment:notify', this.addCommentNotification);
    off('contacts:updated', this.fetchPinnedDirectUserIds);
    off('user:updated', this.onUsersUpdated);
    off('call:incoming', this.onCallIncoming);
    off('call:accepted', this.onCallAccepted);
    off('call:ended', this.onCallEnded);
    off('call:signal', this.onCallSignal);
    off('ws:disconnected', this.onWsDisconnectedWithCall);
    off('ws:reconnected', this.onWsReconnected);
    off('ws:session-expired', this.onWsSessionExpired);

    window.removeEventListener('keydown', this.onWindowKeydown);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('click', this.onWindowClick);
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
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
    if (this.notificationSoundPlayer) {
      void this.notificationSoundPlayer.dispose();
      this.notificationSoundPlayer = null;
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
    this.disposeCallRuntime(false);
  },
};
