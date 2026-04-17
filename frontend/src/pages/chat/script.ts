import {ref, nextTick} from 'vue';
import type {Dialog, Message, MessageReaction, User} from '@/composables/types';
import {linkify} from '@/composables/utils';
import {ws} from '@/composables/classes/ws';
import {on, off} from '@/composables/event-bus';
import {getApiBase} from '@/composables/api';
import {
  getSessionToken,
  restoreSession,
  setWsReconnectDialogResolver,
  wsConnectionState,
  wsChangePassword,
  wsLogout,
  wsUpdateProfile,
} from '@/composables/ws-rpc';
import ChatMessageItem from './message-item/index.vue';
import {
  BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  HANDLED_MESSAGE_IDS_LIMIT,
  SOUND_ENABLED_STORAGE_KEY,
  SOUND_OVERLAY_SKIP_ONCE_KEY,
  consumeSessionFlagOnce,
  getHandledMessageIdsStorageKey,
  loadBooleanSetting,
  loadHandledMessageIds,
  normalizeHandledMessageIdsMap,
  persistBooleanSetting,
  persistHandledMessageIds,
} from './helpers/storage';

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
  authorDonationBadgeUntil: string | null;
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

type RouteMode = 'push' | 'replace' | 'none';

const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MENTION_TAG_RE = /@([a-zA-Z0-9._-]+)/g;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const REACTION_EMOJIS = ['🙂', '👍', '😂', '🔥', '❤️', '🤔', '☹️', '😡', '👎', '😢'];
const MAX_PASTE_IMAGE_BYTES = 1024 * 1024;
const HISTORY_BATCH_SIZE = 100;
const VIRTUAL_MAX_ITEMS = 300;
const VIRTUAL_OVERSCAN = 40;
const VIRTUAL_ESTIMATED_ITEM_HEIGHT = 132;
const COLOR_HEX_FULL_RE = /^#[0-9a-fA-F]{6}$/;
const COMPOSER_NAMED_COLORS = [
  {name: 'red', swatch: '#ff5d5d'},
  {name: 'green', swatch: '#79d279'},
  {name: 'blue', swatch: '#6aa8ff'},
  {name: 'yellow', swatch: '#ffd75f'},
  {name: 'orange', swatch: '#ff9f43'},
  {name: 'gray', swatch: '#9ba7b8'},
  {name: 'cyan', swatch: '#56d7ff'},
  {name: 'purple', swatch: '#be8cff'},
];
const COMPOSER_EMOJIS = ['🙂', '😀', '😉', '😎', '🤔', '😴', '🥳', '🔥', '💬', '✅', '❤️', '👍', '👎', '😢', '😡', '😂'];
const HANDLED_MESSAGE_IDS_SAVE_DELAY_MS = 180;
const NOTIFICATION_SOUND_VOLUME = 0.35;
const MAX_ACTIVE_BROWSER_NOTIFICATIONS = 6;
const DONATION_BADGE_FADE_MS = 5 * 24 * 60 * 60 * 1000;

type SoundRuntimeState = {
  overlayHandled: boolean;
  soundReady: boolean;
};

export default {
  components: {
    ChatMessageItem,
  },

  async setup() {
    return {
      router: useRouter(),
      route: useRoute(),

      me: ref<User | null>(null),
      users: ref<User[]>([]),
      directDialogs: ref<DirectDialog[]>([]),
      generalDialog: ref<Dialog | null>(null),
      activeDialog: ref<Dialog | null>(null),

      messages: ref<Message[]>([]),
      messageText: ref(''),
      composerToolsOpen: ref(false),
      composerColorPicker: ref('#61afef'),
      composerSelectionStart: ref(0),
      composerSelectionEnd: ref(0),
      editingMessageId: ref<number | null>(null),
      editingMessageText: ref(''),
      messageActionPendingId: ref<number | null>(null),
      error: ref(''),
      historyLoading: ref(false),
      historyLoadingMore: ref(false),
      historyHasMore: ref(true),
      historyLoadSeq: ref(0),
      virtualMessageHeights: ref<Record<number, number>>({}),
      virtualPrefixHeights: ref<number[]>([0]),
      virtualTotalHeight: ref(0),
      virtualRangeStart: ref(0),
      virtualRangeEnd: ref(0),
      virtualSyncScheduled: ref(false),
      messagesEl: ref<HTMLDivElement | null>(null),
      messageInputEl: ref<HTMLTextAreaElement | null>(null),
      galleryInputEl: ref<HTMLInputElement | null>(null),
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
      messageHtmlCache: ref<Record<string, string>>({}),
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
      badgeNowTs: ref(Date.now()),
      badgeTickTimer: ref<number | null>(null),
      handledMessageNotificationIds: ref<Record<number, true>>({}),
      handledMessageNotificationSaveTimer: ref<number | null>(null),
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
      soundEnabled: ref(true),
      soundOverlayVisible: ref(false),
      soundReady: ref(false),
      notificationAudioEl: ref<HTMLAudioElement | null>(null),
      browserNotificationsEnabled: ref(true),
      browserNotificationPermission: ref<'default' | 'denied' | 'granted'>('default'),
      activeBrowserNotifications: ref<Notification[]>([]),
      routeSyncReady: ref(false),
      wsConnectionState,

      newPassword: ref(''),
      pasteUploading: ref(false),

      chatMessageHandler: ref<Function | null>(null),
      chatMessageUpdatedHandler: ref<Function | null>(null),
      chatMessageDeletedHandler: ref<Function | null>(null),
      chatReactionsHandler: ref<Function | null>(null),
      dialogsDeletedHandler: ref<Function | null>(null),
      chatReactionNotifyHandler: ref<Function | null>(null),
      usersUpdatedHandler: ref<Function | null>(null),
      disconnectedHandler: ref<Function | null>(null),
      reconnectedHandler: ref<Function | null>(null),
      sessionExpiredHandler: ref<Function | null>(null),
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
    loadHandledMessageNotificationIds(this: any) {
      const storageKey = getHandledMessageIdsStorageKey(this.me?.id);
      if (!storageKey) {
        this.handledMessageNotificationIds = {};
        return;
      }

      this.handledMessageNotificationIds = loadHandledMessageIds(storageKey, HANDLED_MESSAGE_IDS_LIMIT);
    },

    persistHandledMessageNotificationIds(this: any) {
      const storageKey = getHandledMessageIdsStorageKey(this.me?.id);
      if (!storageKey) return;

      const normalized = normalizeHandledMessageIdsMap(this.handledMessageNotificationIds, HANDLED_MESSAGE_IDS_LIMIT);
      this.handledMessageNotificationIds = normalized.normalizedMap;
      persistHandledMessageIds(storageKey, normalized.ids);
    },

    scheduleHandledMessageNotificationIdsSave(this: any) {
      if (typeof window === 'undefined') return;

      if (this.handledMessageNotificationSaveTimer) {
        clearTimeout(this.handledMessageNotificationSaveTimer);
      }

      this.handledMessageNotificationSaveTimer = window.setTimeout(() => {
        this.handledMessageNotificationSaveTimer = null;
        this.persistHandledMessageNotificationIds();
      }, HANDLED_MESSAGE_IDS_SAVE_DELAY_MS);
    },

    loadSoundEnabledSetting(this: any) {
      this.soundEnabled = loadBooleanSetting(SOUND_ENABLED_STORAGE_KEY, true);
    },

    persistSoundEnabledSetting(this: any) {
      persistBooleanSetting(SOUND_ENABLED_STORAGE_KEY, !!this.soundEnabled);
    },

    getSoundRuntimeState(this: any): SoundRuntimeState {
      if (typeof window === 'undefined') {
        return {
          overlayHandled: false,
          soundReady: false,
        };
      }

      const key = '__marxSoundRuntimeState';
      const runtime = (window as any)[key] as SoundRuntimeState | undefined;
      if (runtime) return runtime;

      const next: SoundRuntimeState = {
        overlayHandled: false,
        soundReady: false,
      };
      (window as any)[key] = next;
      return next;
    },

    consumeSoundOverlaySkipOnce(this: any) {
      return consumeSessionFlagOnce(SOUND_OVERLAY_SKIP_ONCE_KEY, '1');
    },

    ensureNotificationAudio(this: any) {
      if (typeof window === 'undefined') return null;
      if (this.notificationAudioEl) return this.notificationAudioEl as HTMLAudioElement;

      const audio = new Audio('/ping.mp3');
      audio.preload = 'auto';
      audio.volume = NOTIFICATION_SOUND_VOLUME;
      this.notificationAudioEl = audio;
      return audio;
    },

    markSoundReady(this: any) {
      if (!this.soundEnabled) return;
      this.soundReady = true;
      const runtime = this.getSoundRuntimeState();
      runtime.soundReady = true;
      runtime.overlayHandled = true;
      this.ensureNotificationAudio();
    },

    resolveSoundStartupState(this: any) {
      const runtime = this.getSoundRuntimeState();
      this.loadSoundEnabledSetting();
      if (!this.soundEnabled) {
        this.soundOverlayVisible = false;
        this.soundReady = false;
        runtime.overlayHandled = true;
        runtime.soundReady = false;
        return;
      }

      const skipOverlayOnce = this.consumeSoundOverlaySkipOnce();
      if (skipOverlayOnce) {
        this.soundOverlayVisible = false;
        this.markSoundReady();
        return;
      }

      if (runtime.soundReady) {
        this.soundOverlayVisible = false;
        this.soundReady = true;
        runtime.overlayHandled = true;
        return;
      }

      if (runtime.overlayHandled) {
        this.soundOverlayVisible = false;
        this.soundReady = false;
        return;
      }

      this.soundOverlayVisible = true;
      this.soundReady = false;
      runtime.overlayHandled = true;
    },

    async playNotificationSound(this: any) {
      if (!this.soundEnabled || !this.soundReady) return;

      const audio = this.ensureNotificationAudio();
      if (!audio) return;

      audio.volume = NOTIFICATION_SOUND_VOLUME;

      try {
        audio.pause();
        audio.currentTime = 0;
        await audio.play();
      } catch {
        this.soundReady = false;
      }
    },

    onSoundOverlayConfirm(this: any) {
      this.soundOverlayVisible = false;
      this.markSoundReady();
    },

    onSoundEnabledChange(this: any) {
      const runtime = this.getSoundRuntimeState();
      this.soundEnabled = !!this.soundEnabled;
      this.persistSoundEnabledSetting();
      if (!this.soundEnabled) {
        this.soundOverlayVisible = false;
        this.soundReady = false;
        runtime.overlayHandled = true;
        runtime.soundReady = false;
        return;
      }
      runtime.overlayHandled = true;
      this.markSoundReady();
    },

    isBrowserNotificationsSupported(this: any) {
      return typeof window !== 'undefined' && 'Notification' in window;
    },

    syncBrowserNotificationPermission(this: any) {
      if (!this.isBrowserNotificationsSupported()) {
        this.browserNotificationPermission = 'denied';
        return;
      }
      this.browserNotificationPermission = Notification.permission;
    },

    loadBrowserNotificationsEnabledSetting(this: any) {
      this.browserNotificationsEnabled = loadBooleanSetting(BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY, true);
    },

    persistBrowserNotificationsEnabledSetting(this: any) {
      persistBooleanSetting(BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY, !!this.browserNotificationsEnabled);
    },

    async requestBrowserNotificationPermission(this: any) {
      this.syncBrowserNotificationPermission();
      if (!this.isBrowserNotificationsSupported()) return;
      if (this.browserNotificationPermission === 'granted') return;

      try {
        const next = await Notification.requestPermission();
        this.browserNotificationPermission = next;
      } catch {
        this.browserNotificationPermission = Notification.permission;
      }
    },

    onBrowserNotificationsEnabledChange(this: any) {
      this.browserNotificationsEnabled = !!this.browserNotificationsEnabled;
      this.persistBrowserNotificationsEnabledSetting();
      if (!this.browserNotificationsEnabled) return;
      if (this.browserNotificationPermission === 'default') {
        void this.requestBrowserNotificationPermission();
      }
    },

    closeOldBrowserNotifications(this: any) {
      if (!Array.isArray(this.activeBrowserNotifications) || this.activeBrowserNotifications.length <= MAX_ACTIVE_BROWSER_NOTIFICATIONS) {
        return;
      }

      const overflow = this.activeBrowserNotifications.length - MAX_ACTIVE_BROWSER_NOTIFICATIONS;
      const toClose = this.activeBrowserNotifications.slice(0, overflow);
      toClose.forEach((item: Notification) => item.close());
      this.activeBrowserNotifications = this.activeBrowserNotifications.slice(overflow);
    },

    showBrowserNotification(this: any, notification: NotificationItem) {
      if (!this.browserNotificationsEnabled) return;
      if (this.browserNotificationPermission !== 'granted') return;
      if (!this.isWindowInactive()) return;
      if (!this.isBrowserNotificationsSupported()) return;

      const systemNotification = new Notification(
        this.getNotificationDialogTitle(notification),
        {
          body: `${notification.authorName}: ${this.getNotificationBodyPreview(notification)}`,
          icon: '/favicon-alert.png',
          tag: `marx-${notification.notificationType}-${notification.id}`,
          data: {
            notificationId: notification.id,
          },
        }
      );

      systemNotification.onclick = () => {
        try {
          window.focus();
        } catch {}
        const target = this.notifications.find((item: NotificationItem) => item.id === notification.id);
        if (target) {
          void this.openNotification(target);
        }
        systemNotification.close();
      };

      systemNotification.onclose = () => {
        this.activeBrowserNotifications = this.activeBrowserNotifications.filter((item: Notification) => item !== systemNotification);
      };

      this.activeBrowserNotifications = [...this.activeBrowserNotifications, systemNotification];
      this.closeOldBrowserNotifications();
    },

    initBrowserNotifications(this: any) {
      this.loadBrowserNotificationsEnabledSetting();
      this.syncBrowserNotificationPermission();
      if (!this.browserNotificationsEnabled) return;
      if (this.browserNotificationPermission !== 'default') return;
      void this.requestBrowserNotificationPermission();
    },

    normalizeRouteNickname(this: any, nicknameRaw: unknown) {
      return String(nicknameRaw || '').trim().toLowerCase();
    },

    buildDirectRoutePath(this: any, nicknameRaw: unknown) {
      const nickname = this.normalizeRouteNickname(nicknameRaw);
      if (!nickname) return '/chat';
      return `/direct/${encodeURIComponent(nickname)}`;
    },

    getDirectNicknameFromRoute(this: any) {
      const path = String(this.route?.path || '');
      if (!path.startsWith('/direct/')) return '';

      const raw = Array.isArray(this.route?.params?.username)
        ? this.route.params.username[0]
        : this.route?.params?.username;
      const decoded = decodeURIComponent(String(raw || ''));
      return this.normalizeRouteNickname(decoded);
    },

    findUserByNickname(this: any, nicknameRaw: unknown) {
      const nickname = this.normalizeRouteNickname(nicknameRaw);
      if (!nickname) return null;

      const fromUsers = this.users.find((user: User) => user.nickname.toLowerCase() === nickname);
      if (fromUsers) return fromUsers;

      const fromDirects = this.directDialogs
        .map((dialog: DirectDialog) => dialog.targetUser)
        .find((user: User) => user.nickname.toLowerCase() === nickname);
      if (fromDirects) return fromDirects;

      return null;
    },

    async syncRouteForDialog(this: any, dialog: Dialog, modeRaw?: RouteMode) {
      const mode = modeRaw || 'push';
      if (mode === 'none') return;

      const targetPath = dialog.kind === 'private'
        ? this.buildDirectRoutePath(dialog.targetUser?.nickname)
        : '/chat';
      const currentPath = String(this.route?.path || '');
      if (currentPath === targetPath) return;

      if (mode === 'replace') {
        await this.router.replace(targetPath);
        return;
      }
      await this.router.push(targetPath);
    },

    async syncDialogFromRoute(this: any, optionsRaw?: {replaceInvalid?: boolean}) {
      const replaceInvalid = optionsRaw?.replaceInvalid !== false;
      const directNickname = this.getDirectNicknameFromRoute();
      if (!directNickname) {
        if (this.generalDialog) {
          await this.selectDialog(this.generalDialog, {routeMode: 'none'});
          if (replaceInvalid && String(this.route?.path || '') !== '/chat') {
            await this.router.replace('/chat');
          }
        }
        return;
      }

      const targetUser = this.findUserByNickname(directNickname);
      if (!targetUser || targetUser.id === this.me?.id) {
        if (replaceInvalid) {
          await this.router.replace('/chat');
        }
        if (this.generalDialog) {
          await this.selectDialog(this.generalDialog, {routeMode: 'none'});
        }
        return;
      }

      await this.selectPrivate(targetUser, {
        routeMode: 'none',
        closeMenu: false,
        refreshDirects: true,
      });

      const canonicalPath = this.buildDirectRoutePath(targetUser.nickname);
      if (String(this.route?.path || '') !== canonicalPath) {
        await this.router.replace(canonicalPath);
      }
    },

    async onRouteChanged(this: any) {
      if (!this.routeSyncReady || !this.generalDialog) return;

      const path = String(this.route?.path || '');
      if (path === '/chat') {
        if (this.activeDialog?.kind === 'general') return;
        await this.selectGeneral({routeMode: 'none', closeMenu: false});
        return;
      }

      const directNickname = this.getDirectNicknameFromRoute();
      if (!directNickname) return;

      if (
        this.activeDialog?.kind === 'private'
        && this.normalizeRouteNickname(this.activeDialog?.targetUser?.nickname) === directNickname
      ) {
        return;
      }

      const targetUser = this.findUserByNickname(directNickname);
      if (!targetUser || targetUser.id === this.me?.id) {
        await this.selectGeneral({routeMode: 'replace', closeMenu: false});
        return;
      }

      await this.selectPrivate(targetUser, {
        routeMode: 'none',
        closeMenu: false,
        refreshDirects: true,
      });
    },

    isDirectDialogUnread(this: any, dialogIdRaw: unknown) {
      const dialogId = Number(dialogIdRaw || 0);
      if (!Number.isFinite(dialogId) || dialogId <= 0) return false;
      return !!this.unreadDirectDialogIds?.[dialogId];
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
      return {
        ...message,
        rawText,
        authorDonationBadgeUntil: message?.authorDonationBadgeUntil
          ? String(message.authorDonationBadgeUntil)
          : null,
        renderedHtml: String(message?.renderedHtml ?? ''),
        reactions: Array.isArray(message?.reactions) ? message.reactions : [],
      } as Message;
    },

    getMessageRawText(this: any, messageRaw: any) {
      return String(messageRaw?.rawText ?? messageRaw?.body ?? '');
    },

    messagePreviewCacheKey(this: any, message: Message) {
      return `${message.id}:${this.getMessageRawText(message)}:${String(message.renderedHtml || '')}`;
    },

    resetMessagePreviewCache(this: any) {
      this.messagePreviewCache = {};
      this.messageHtmlCache = {};
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
      const colorName = String(colorNameRaw || '').trim().toLowerCase();
      if (!colorName) return;
      this.applyWrapperToSelection(`c#${colorName}(`);
      this.closeComposerTools();
    },

    applyCustomColorWrapper(this: any) {
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
      this.appendToInput(`${this.formatUsername(message.authorNickname)}, `);
    },

    onMessageTimeClick(this: any, message: Message) {
      this.appendToInput(`${this.formatUsername(message.authorNickname)} [${this.formatMessageTime(message.createdAt)}], `);
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
        donationBadgeUntil: message.authorDonationBadgeUntil || null,
      } as User);
    },

    isOwnMessage(this: any, message: Message) {
      return this.me?.id === message.authorId;
    },

    startMessageEdit(this: any, message: Message) {
      if (!this.isOwnMessage(message)) return;
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
        if (item.id !== message.id || item.dialogId !== message.dialogId) return item;
        return message;
      });
      this.resetMessagePreviewCache();
      this.notifyMessagesChanged();
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
      this.notifyMessagesChanged();
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
      if (this.containsAllKeyword(this.getMessageRawText(message))) return true;
      if (!meNickname) return false;
      return this.hasMentionToken(this.getMessageRawText(message), meNickname);
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

    resolveDialogKind(this: any, dialogId: number): 'general' | 'private' | 'unknown' {
      const generalId = this.generalDialog?.id || null;
      if (generalId && dialogId === generalId) return 'general';
      return dialogId > 0 ? 'private' : 'unknown';
    },

    isMessageAddressedToMe(this: any, message: Message) {
      if (!message || message.authorId === this.me?.id) return false;
      const dialogKind = this.resolveDialogKind(Number(message.dialogId || 0));
      if (dialogKind === 'private') return true;
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
          `${notification.authorName}: ${this.getNotificationBodyPreview(notification)}`
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
      const dialogKind = this.resolveDialogKind(Number(message.dialogId || 0));
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
        dialogId: message.dialogId,
        dialogKind,
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

      const dialogId = Number(payload?.dialogId);
      if (!Number.isFinite(dialogId)) return;

      const notificationId = this.notificationsSeq;
      this.notificationsSeq += 1;

      const dialogKind = this.resolveDialogKind(dialogId);

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
        dialogId,
        dialogKind,
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
        if (notification.dialogId !== this.activeDialog.id) return true;

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
      this.notificationsMenuOpen = !this.notificationsMenuOpen;
      if (this.notificationsMenuOpen) {
        this.rightMenuOpen = false;
        this.leftMenuOpen = false;
      }
    },

    clearNotifications(this: any) {
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
      const targetMessageId = Number(notification.targetMessageId || 0) || null;
      if (notification.notificationType === 'reaction' || !targetMessageId) {
        this.markNotificationRead(notification.id);
      }

      if (notification.dialogKind === 'general' && this.generalDialog) {
        if (this.activeDialog?.id !== this.generalDialog.id) {
          await this.selectDialog(this.generalDialog);
        }
        this.closeNotificationsMenu();
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
        return;
      }

      const direct = this.directDialogs.find((dialog: DirectDialog) => dialog.dialogId === notification.dialogId);
      if (direct) {
        if (this.activeDialog?.id !== direct.dialogId) {
          await this.selectDialog({
            id: direct.dialogId,
            kind: 'private',
            targetUser: direct.targetUser,
            title: direct.targetUser.name,
          });
        }
        this.closeNotificationsMenu();
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
        return;
      }

      if (notification.targetUser && notification.dialogKind !== 'general') {
        await this.selectPrivate(notification.targetUser);
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
      }
      this.closeNotificationsMenu();
    },

    buildTimeTagTooltip(this: any, message: Message) {
      const normalized = this.getMessageRawText(message).replace(/\s+/g, ' ').trim();
      const preview = normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
      return `${this.formatUsername(message.authorNickname)}: ${preview || '(пусто)'}`;
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

    renderTextChunkHtml(this: any, rawChunkRaw: unknown, sourceIndex: number) {
      const rawChunk = String(rawChunkRaw ?? '');
      const parts = this.linkify(rawChunk);
      let html = '';

      for (const part of parts) {
        if (part.type === 'link') {
          const normalizedUrl = this.normalizeMessageLink(part.value);
          const escapedUrl = this.escapeHtml(normalizedUrl);
          const preview = this.buildLinkPreview(normalizedUrl);
          if (preview?.type === 'image') {
            html += `<a class="inline-image-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"><img class="preview-media preview-image preview-inline-image" src="${escapedUrl}" alt="image preview" loading="lazy" decoding="async"></a>`;
          } else {
            html += `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`;
          }
          continue;
        }

        const text = String(part.value || '');
        const tokenRe = /@([a-zA-Z0-9._-]+)|\[(\d{2}:\d{2}:\d{2})\]/g;
        let lastIndex = 0;
        for (const match of text.matchAll(tokenRe)) {
          if (match.index === undefined) continue;
          if (match.index > lastIndex) {
            html += this.escapeHtml(text.slice(lastIndex, match.index));
          }

          if (match[1]) {
            const nickname = String(match[1] || '').trim();
            const user = this.findMentionUser(nickname);
            if (!user) {
              html += this.escapeHtml(`@${nickname}`);
            } else {
              const username = this.formatUsername(user.nickname);
              const escapedUsername = this.escapeHtml(username);
              const escapedName = this.escapeHtml(user.name);
              const style = user.nicknameColor ? ` style="color:${this.escapeHtml(user.nicknameColor)}"` : '';
              html += `<span class="mention-token" data-mention="${escapedUsername}" title="${escapedUsername}"${style}>${escapedName}</span>`;
            }
          } else {
            const timeLabel = String(match[2] || '');
            const target = this.findClosestMessageByTime(sourceIndex, timeLabel);
            const tooltip = target ? this.buildTimeTagTooltip(target) : 'Сообщение с этим временем не найдено';
            const targetAttr = target?.id ? ` data-target-message-id="${target.id}"` : '';
            html += `<span class="time-reference" data-time-tooltip="${this.escapeHtml(tooltip)}"${targetAttr}>[${this.escapeHtml(timeLabel)}]</span>`;
          }

          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
          html += this.escapeHtml(text.slice(lastIndex));
        }
      }

      return html;
    },

    decorateRenderedHtml(this: any, sourceHtmlRaw: unknown, sourceIndex: number) {
      const sourceHtml = String(sourceHtmlRaw ?? '');
      if (!sourceHtml) return '';

      let html = '';
      let index = 0;
      let insideCode = false;

      while (index < sourceHtml.length) {
        if (sourceHtml[index] === '<') {
          const closeIndex = sourceHtml.indexOf('>', index);
          if (closeIndex < 0) {
            html += this.escapeHtml(this.decodeHtmlEntities(sourceHtml.slice(index)));
            break;
          }

          const tag = sourceHtml.slice(index, closeIndex + 1);
          const tagLower = tag.toLowerCase();
          if (tagLower === '<code>') insideCode = true;
          if (tagLower === '</code>') insideCode = false;
          html += tag;
          index = closeIndex + 1;
          continue;
        }

        const nextTagIndex = sourceHtml.indexOf('<', index);
        const chunk = nextTagIndex < 0
          ? sourceHtml.slice(index)
          : sourceHtml.slice(index, nextTagIndex);

        if (insideCode) {
          html += chunk;
        } else {
          const decodedChunk = this.decodeHtmlEntities(chunk);
          html += this.renderTextChunkHtml(decodedChunk, sourceIndex);
        }

        if (nextTagIndex < 0) break;
        index = nextTagIndex;
      }

      return html;
    },

    getRenderedMessageHtml(this: any, message: Message, sourceIndex: number) {
      const cacheKey = this.messagePreviewCacheKey(message);
      const cached = this.messageHtmlCache[cacheKey];
      if (cached !== undefined) return cached;

      const rendered = String(message.renderedHtml || '').trim();
      const html = rendered
        ? this.decorateRenderedHtml(rendered, sourceIndex)
        : this.renderTextChunkHtml(this.getMessageRawText(message), sourceIndex);

      this.messageHtmlCache = {
        ...this.messageHtmlCache,
        [cacheKey]: html,
      };

      return html;
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

      for (const linkUrl of this.extractMessageLinks(this.getMessageRawText(message))) {
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

    applyMe(this: any, me: User) {
      this.me = me;
      this.profileName = me.name || me.nickname;
      this.profileNicknameColor = me.nicknameColor || '';
      this.profileColorPicker = me.nicknameColor || '#61afef';
    },

    normalizeUser(this: any, raw: any): User | null {
      const id = Number(raw?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return null;
      return {
        id,
        nickname: String(raw?.nickname || '').trim(),
        name: String(raw?.name || raw?.nickname || '').trim(),
        nicknameColor: raw?.nicknameColor ? String(raw.nicknameColor) : null,
        donationBadgeUntil: raw?.donationBadgeUntil ? String(raw.donationBadgeUntil) : null,
      };
    },

    onUsersUpdated(this: any, userRaw: any) {
      const user = this.normalizeUser(userRaw);
      if (!user) return;

      if (this.me?.id === user.id) {
        this.applyMe(user);
      }

      this.users = this.users.map((item: User) => {
        if (item.id !== user.id) return item;
        return {
          ...item,
          ...user,
        };
      });

      this.directDialogs = this.directDialogs.map((dialog: DirectDialog) => {
        if (dialog.targetUser.id !== user.id) return dialog;
        return {
          ...dialog,
          targetUser: {
            ...dialog.targetUser,
            ...user,
          },
        };
      });

      if (this.activeDialog?.kind === 'private' && this.activeDialog?.targetUser?.id === user.id) {
        this.activeDialog = {
          ...this.activeDialog,
          targetUser: {
            ...this.activeDialog.targetUser,
            ...user,
          },
          title: user.name,
        };
      }

      this.messages = this.messages.map((message: Message) => {
        if (message.authorId !== user.id) return message;
        return {
          ...message,
          authorName: user.name,
          authorNickname: user.nickname,
          authorNicknameColor: user.nicknameColor,
          authorDonationBadgeUntil: user.donationBadgeUntil || null,
        };
      });

      this.notifications = this.notifications.map((notification: NotificationItem) => {
        const matchesAuthor = notification.authorId === user.id;
        const matchesTarget = notification.targetUser?.id === user.id;
        if (!matchesAuthor && !matchesTarget) return notification;

        return {
          ...notification,
          authorName: matchesAuthor ? user.name : notification.authorName,
          authorNickname: matchesAuthor ? user.nickname : notification.authorNickname,
          authorNicknameColor: matchesAuthor ? user.nicknameColor : notification.authorNicknameColor,
          authorDonationBadgeUntil: matchesAuthor
            ? (user.donationBadgeUntil || null)
            : notification.authorDonationBadgeUntil,
          targetUser: matchesTarget
            ? {
              ...notification.targetUser!,
              ...user,
            }
            : notification.targetUser,
        };
      });
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
      this.loadHandledMessageNotificationIds();
      return true;
    },

    async fetchUsers(this: any) {
      const result = await ws.request('users:list');
      if (Array.isArray(result)) {
        this.users = result
          .map((row: any) => this.normalizeUser(row))
          .filter(Boolean) as User[];
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

    async loadHistory(this: any, dialogId: number, seq: number, beforeMessageId: number | null = null) {
      const isInitialLoad = !beforeMessageId;
      if (seq === this.historyLoadSeq) {
        if (isInitialLoad) {
          this.historyLoading = true;
        } else {
          this.historyLoadingMore = true;
        }
      }

      const prevScrollTop = this.messagesEl?.scrollTop || 0;
      const prevScrollHeight = this.messagesEl?.scrollHeight || 0;

      try {
        const result = await ws.request('dialogs:messages', dialogId, HISTORY_BATCH_SIZE, beforeMessageId);
        if (seq !== this.historyLoadSeq) return;
        if (!Array.isArray(result)) {
          this.error = 'Не удалось загрузить историю.';
          return;
        }

        const nextChunk = result.map((message: any) => this.normalizeMessage(message));
        this.historyHasMore = nextChunk.length >= HISTORY_BATCH_SIZE;
        if (isInitialLoad) {
          this.seedNotificationsFromMessages(nextChunk);
        }

        if (isInitialLoad) {
          this.messages = nextChunk;
          this.notifyMessagesChanged();
          this.syncVirtualWindowFromScroll();
          await nextTick();
          this.scrollToBottomPinned();
          this.markVisibleMessageNotificationsRead();
          return;
        }

        if (!nextChunk.length) {
          this.historyHasMore = false;
          return;
        }

        this.messages = [...nextChunk, ...this.messages];
        this.notifyMessagesChanged();
        this.syncVirtualWindowFromScroll();
        await nextTick();
        if (!this.messagesEl) return;
        const nextScrollHeight = this.messagesEl.scrollHeight;
        this.messagesEl.scrollTop = Math.max(0, nextScrollHeight - prevScrollHeight + prevScrollTop);
        this.scheduleVirtualSync();
        this.markVisibleMessageNotificationsRead();
      } finally {
        if (seq === this.historyLoadSeq) {
          this.historyLoading = false;
          this.historyLoadingMore = false;
        }
      }
    },

    async loadOlderHistory(this: any) {
      if (this.historyLoading || this.historyLoadingMore || !this.historyHasMore) return;
      if (!this.activeDialog || !this.messages.length) return;

      const oldestMessage = this.messages[0];
      if (!oldestMessage?.id) {
        this.historyHasMore = false;
        return;
      }

      await this.loadHistory(this.activeDialog.id, this.historyLoadSeq, oldestMessage.id);
    },

    async joinDialog(this: any, dialogId: number) {
      const result = await ws.request('chat:join', dialogId);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось подключиться к диалогу.';
      }
    },

    async selectDialog(this: any, dialog: Dialog, optionsRaw?: {routeMode?: RouteMode}) {
      const seq = this.historyLoadSeq + 1;
      this.historyLoadSeq = seq;
      this.activeDialog = dialog;
      this.messages = [];
      this.historyHasMore = true;
      this.historyLoadingMore = false;
      this.resetMessagePreviewCache();
      this.error = '';
      this.notificationsMenuOpen = false;
      this.virtualMessageHeights = {};
      this.virtualPrefixHeights = [0];
      this.virtualTotalHeight = 0;
      this.virtualRangeStart = 0;
      this.virtualRangeEnd = 0;
      await this.loadHistory(dialog.id, seq);
      await this.joinDialog(dialog.id);
      await this.syncRouteForDialog(dialog, optionsRaw?.routeMode || 'push');
    },

    async selectGeneral(this: any, optionsRaw?: {routeMode?: RouteMode; closeMenu?: boolean}) {
      if (!this.generalDialog) return;
      await this.selectDialog(this.generalDialog, {routeMode: optionsRaw?.routeMode || 'push'});
      if (optionsRaw?.closeMenu !== false) {
        this.closeLeftMenu();
      }
    },

    async onGoToGeneralChat(this: any) {
      await this.selectGeneral();
    },

    async onOpenVpnPage(this: any) {
      this.notificationsMenuOpen = false;
      this.leftMenuOpen = false;
      this.rightMenuOpen = false;
      await this.router.push('/vpn');
    },

    async selectPrivate(this: any, user: User, optionsRaw?: {routeMode?: RouteMode; closeMenu?: boolean; refreshDirects?: boolean}) {
      const dialog = await this.fetchPrivateDialog(user);
      if (!dialog) return;
      await this.selectDialog(dialog, {routeMode: optionsRaw?.routeMode || 'push'});
      if (optionsRaw?.closeMenu !== false) {
        this.closeLeftMenu();
      }
      if (optionsRaw?.refreshDirects !== false) {
        await this.fetchDirectDialogs();
      }
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
      }, {routeMode: 'push'});
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
            authorDonationBadgeUntil: this.me!.donationBadgeUntil || null,
          };
        });
        this.notifyMessagesChanged();

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
      if (this.wsConnectionState !== 'connected') {
        this.error = this.wsConnectionState === 'connecting'
          ? 'Подключение восстанавливается. Сообщение не отправлено.'
          : 'Оффлайн. Сообщение не отправлено.';
        return false;
      }

      const text = String(textRaw || '').trim();
      if (!text) return false;

      const result = await ws.request('chat:send', this.activeDialog.id, text);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось отправить сообщение.';
        return false;
      }

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
      if (!this.error || this.error.startsWith('Соединение потеряно.')) {
        this.error = 'Соединение потеряно. Переподключаюсь...';
      }
    },

    async onWsReconnected(this: any) {
      if (this.error.startsWith('Соединение потеряно.')) {
        this.error = '';
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
    Object.values(this.toastTimerById).forEach((timerId: number) => clearTimeout(timerId));
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
