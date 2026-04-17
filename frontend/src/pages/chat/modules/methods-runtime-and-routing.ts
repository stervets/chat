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
  HANDLED_MESSAGE_IDS_SAVE_DELAY_MS,
  NOTIFICATION_SOUND_VOLUME,
  MAX_ACTIVE_BROWSER_NOTIFICATIONS,
} from './shared';
import type {
  Dialog,
  User,
  DirectDialog,
  NotificationItem,
  RouteMode,
  SoundRuntimeState,
} from './shared';
export const chatMethodsRuntimeAndRouting = {
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

};
