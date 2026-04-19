import {
  BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  HANDLED_MESSAGE_IDS_LIMIT,
  SOUND_ENABLED_STORAGE_KEY,
  WEB_PUSH_ENABLED_STORAGE_KEY,
  getHandledMessageIdsStorageKey,
  loadBooleanSetting,
  loadHandledMessageIds,
  normalizeHandledMessageIdsMap,
  persistBooleanSetting,
  persistHandledMessageIds,
  HANDLED_MESSAGE_IDS_SAVE_DELAY_MS,
  NOTIFICATION_SOUND_VOLUME,
  MAX_ACTIVE_BROWSER_NOTIFICATIONS,
  getApiBase,
  getSessionToken,
} from './shared';
import type {
  Dialog,
  User,
  DirectDialog,
  NotificationItem,
  RouteMode,
  SoundRuntimeState,
} from './shared';
import {
  fetchWebPushServerConfig,
  getWebPushPermission,
  isIosForWebPush,
  isStandaloneDisplayMode,
  isWebPushSupported,
  sendWebPushTest,
  subscribeWebPush,
  type WebPushDiagEvent,
  type WebPushPermission,
  unsubscribeWebPush,
} from '@/composables/use-web-push';

const WEB_PUSH_ROLLOUT_VERSION = '2026-04-19-1';

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

      this.soundOverlayVisible = false;
      if (runtime.soundReady) {
        this.soundReady = true;
        runtime.overlayHandled = true;
        return;
      }

      this.soundReady = false;
      runtime.overlayHandled = true;
    },

    async playNotificationSound(this: any) {
      if (!this.soundEnabled || !this.soundReady) return;
      if (this.isWindowInactive()) return;

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

    loadWebPushEnabledSetting(this: any) {
      this.webPushSettingEnabled = loadBooleanSetting(WEB_PUSH_ENABLED_STORAGE_KEY, true);
    },

    persistWebPushEnabledSetting(this: any) {
      persistBooleanSetting(WEB_PUSH_ENABLED_STORAGE_KEY, !!this.webPushSettingEnabled);
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
      if (this.isStandaloneApp) return;
      if (!this.browserNotificationsEnabled) return;
      if (this.webPushEnabled) return;
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
      if (this.isStandaloneApp) {
        this.browserNotificationsEnabled = false;
        return;
      }
      this.loadBrowserNotificationsEnabledSetting();
      this.syncBrowserNotificationPermission();
      if (!this.browserNotificationsEnabled) return;
      if (this.browserNotificationPermission !== 'default') return;
      void this.requestBrowserNotificationPermission();
    },

    getWebPushRolloutStorageKey(this: any) {
      const userId = Number(this.me?.id || 0);
      if (Number.isFinite(userId) && userId > 0) {
        return `__marxWebPushRolloutVersion:${userId}`;
      }
      return '__marxWebPushRolloutVersion:guest';
    },

    isWebPushRolloutApplied(this: any) {
      if (typeof window === 'undefined') return true;
      const key = this.getWebPushRolloutStorageKey();
      try {
        const current = String(localStorage.getItem(key) || '').trim();
        return current === WEB_PUSH_ROLLOUT_VERSION;
      } catch {
        return false;
      }
    },

    markWebPushRolloutApplied(this: any) {
      if (typeof window === 'undefined') return;
      const key = this.getWebPushRolloutStorageKey();
      try {
        localStorage.setItem(key, WEB_PUSH_ROLLOUT_VERSION);
      } catch {
        // no-op
      }
    },

    clearWebPushDiagnostic(this: any) {
      this.webPushDiagnosticLines = [];
    },

    appendWebPushDiagnosticLine(this: any, lineRaw: unknown) {
      const line = String(lineRaw || '').replace(/\s+/g, ' ').trim();
      if (!line) return;
      this.webPushDiagnosticLines = [line, ...this.webPushDiagnosticLines].slice(0, 12);
    },

    formatWebPushDiagnosticEvent(this: any, eventRaw: WebPushDiagEvent) {
      const stage = String(eventRaw?.stage || '').trim() || 'unknown_stage';
      const level = eventRaw?.level === 'warn' ? 'warn' : 'info';
      const details = eventRaw?.details && typeof eventRaw.details === 'object'
        ? Object.entries(eventRaw.details)
          .map(([key, value]) => `${key}=${String(value ?? '').replace(/\s+/g, ' ').trim() || 'empty'}`)
          .join(', ')
        : '';
      return details ? `[${level}] ${stage} | ${details}` : `[${level}] ${stage}`;
    },

    onWebPushDiagnostic(this: any, eventRaw: WebPushDiagEvent) {
      if (!this.isDevMode) return;
      const line = this.formatWebPushDiagnosticEvent(eventRaw);
      this.appendWebPushDiagnosticLine(line);
    },

    getWebPushDiagReporter(this: any) {
      if (!this.isDevMode) return undefined;
      return (event: WebPushDiagEvent) => this.onWebPushDiagnostic(event);
    },

    async initWebPush(this: any) {
      this.webPushError = '';
      this.webPushTestStatus = '';
      this.webPushSynced = false;
      this.clearWebPushDiagnostic();
      this.loadWebPushEnabledSetting();
      this.webPushSupported = isWebPushSupported();
      this.webPushPermission = getWebPushPermission();
      this.webPushRequiresIosInstall = isIosForWebPush() && !isStandaloneDisplayMode();

      if (!this.webPushSupported) {
        this.webPushAvailable = false;
        this.webPushEnabled = false;
        this.webPushSynced = false;
        this.webPushVapidPublicKey = '';
        return;
      }

      const apiBase = getApiBase();
      const serverConfig = await fetchWebPushServerConfig(apiBase);
      this.webPushAvailable = !!serverConfig.enabled;
      this.webPushVapidPublicKey = serverConfig.vapidPublicKey;
      if (!this.webPushAvailable) {
        this.webPushEnabled = false;
        this.webPushSynced = false;
        return;
      }

      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (!registration) {
        this.webPushEnabled = false;
        this.webPushSynced = false;
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      this.webPushEnabled = !!existing && this.webPushPermission === 'granted';
      this.webPushSynced = false;

      if (existing && this.webPushPermission === 'granted') {
        const token = getSessionToken();
        const shouldForceRenew = !this.isWebPushRolloutApplied();
        if (shouldForceRenew) {
          await unsubscribeWebPush(apiBase, token);
        }
        const subscribeResult = await subscribeWebPush(
          apiBase,
          token,
          this.webPushVapidPublicKey,
          this.getWebPushDiagReporter(),
        );
        if (!subscribeResult.ok) {
          this.webPushEnabled = false;
          this.webPushSynced = false;
          this.webPushError = this.resolveWebPushSubscribeError(subscribeResult.error, subscribeResult.details);
          return;
        }
        this.webPushEnabled = true;
        this.webPushSynced = true;
        this.markWebPushRolloutApplied();
      }

      if (!this.isStandaloneApp) return;
      if (!this.webPushSettingEnabled && this.webPushEnabled) {
        await this.disableWebPush();
        return;
      }
      if (this.webPushSettingEnabled && !this.webPushEnabled && this.webPushPermission !== 'denied') {
        await this.enableWebPush();
      }
    },

    resolveWebPushSubscribeError(this: any, errorCodeRaw: unknown, detailsRaw?: unknown) {
      const errorCode = String(errorCodeRaw || '').trim();
      const details = String(detailsRaw || '').trim();
      if (errorCode === 'invalid_vapid_key') {
        return 'Некорректный VAPID public key.';
      }
      if (errorCode === 'service_worker_ready_failed') {
        return 'Service worker не активировался. Обнови страницу и попробуй снова.';
      }
      if (errorCode === 'get_subscription_failed') {
        return `Не удалось прочитать текущую push-подписку: ${details || 'unknown_error'}`;
      }
      if (errorCode === 'subscribe_failed') {
        return `Браузер отклонил создание push-подписки: ${details || 'unknown_error'}`;
      }
      if (errorCode === 'sync_failed') {
        return `Разрешение есть, но backend не сохранил подписку (sync_failed): ${details || 'unknown_error'}`;
      }
      return 'Не удалось сохранить push-подписку на сервере.';
    },

    async enableWebPush(this: any) {
      if (this.webPushBusy) return;
      this.webPushBusy = true;
      this.webPushError = '';
      this.webPushTestStatus = '';
      this.clearWebPushDiagnostic();

      try {
        if (!this.webPushSupported) {
          this.webPushError = 'Браузер не поддерживает Web Push.';
          this.webPushSynced = false;
          return;
        }

        const apiBase = getApiBase();
        const token = getSessionToken();
        if (!this.webPushAvailable || !this.webPushVapidPublicKey) {
          const serverConfig = await fetchWebPushServerConfig(apiBase);
          this.webPushAvailable = !!serverConfig.enabled;
          this.webPushVapidPublicKey = serverConfig.vapidPublicKey;
          if (!this.webPushAvailable || !this.webPushVapidPublicKey) {
            this.webPushError = 'Web Push сейчас отключён на сервере.';
            this.webPushSynced = false;
            return;
          }
        }

        this.webPushPermission = getWebPushPermission();
        if (this.isDevMode) {
          console.info('[web-push] Notification.permission before request', {
            permission: this.webPushPermission,
          });
        }
        if (this.isDevMode) {
          this.appendWebPushDiagnosticLine(`permission_before=${this.webPushPermission}`);
        }
        if (this.webPushPermission === 'denied') {
          this.webPushError = 'Уведомления запрещены в настройках браузера.';
          this.webPushSynced = false;
          return;
        }

        if (this.webPushPermission === 'default') {
          try {
            const requested = await Notification.requestPermission();
            this.webPushPermission = requested as WebPushPermission;
          } catch {
            this.webPushPermission = getWebPushPermission();
          }
        }

        if (this.isDevMode) {
          console.info('[web-push] Notification.permission after request', {
            permission: this.webPushPermission,
          });
        }
        if (this.isDevMode) {
          this.appendWebPushDiagnosticLine(`permission_after=${this.webPushPermission}`);
        }

        if (this.webPushPermission !== 'granted') {
          this.webPushError = 'Без разрешения браузера push не включится.';
          this.webPushSynced = false;
          return;
        }

        const subscribeResult = await subscribeWebPush(
          apiBase,
          token,
          this.webPushVapidPublicKey,
          this.getWebPushDiagReporter(),
        );
        if (!subscribeResult.ok) {
          this.webPushEnabled = false;
          this.webPushSynced = false;
          this.webPushError = this.resolveWebPushSubscribeError(subscribeResult.error, subscribeResult.details);
          return;
        }

        this.webPushEnabled = true;
        this.webPushSynced = true;
        this.markWebPushRolloutApplied();
      } catch {
        this.webPushError = 'Не удалось включить push-уведомления.';
        this.webPushSynced = false;
      } finally {
        this.webPushBusy = false;
      }
    },

    async disableWebPush(this: any) {
      if (this.webPushBusy) return;
      if (!this.webPushSupported) return;
      this.webPushBusy = true;
      this.webPushError = '';
      this.webPushTestStatus = '';

      try {
        const apiBase = getApiBase();
        const token = getSessionToken();
        await unsubscribeWebPush(apiBase, token);
        this.webPushEnabled = false;
        this.webPushSynced = false;
      } catch {
        this.webPushError = 'Не удалось отключить push-уведомления.';
      } finally {
        this.webPushBusy = false;
      }
    },

    onWebPushEnabledChange(this: any) {
      this.webPushSettingEnabled = !!this.webPushSettingEnabled;
      this.persistWebPushEnabledSetting();
      if (this.webPushSettingEnabled) {
        void this.enableWebPush();
        return;
      }
      void this.disableWebPush();
    },

    async sendWebPushTest(this: any) {
      if (!this.isDevMode) return;
      if (this.webPushTestBusy) return;
      if (!this.canSendWebPushTest) {
        this.webPushError = 'Для теста нужен granted permission или включённый Web Push.';
        return;
      }

      this.webPushTestBusy = true;
      this.webPushError = '';
      this.webPushTestStatus = '';

      try {
        const apiBase = getApiBase();
        const token = getSessionToken();
        const result = await sendWebPushTest(apiBase, token);

        if (!result.ok) {
          if (result.error === 'no_subscriptions') {
            this.webPushSynced = false;
            this.webPushTestStatus = 'Нет активных подписок';
            this.pushToast('Web Push', 'Нет активных подписок');
            return;
          }

          this.webPushTestStatus = 'Ошибка тестовой отправки';
          this.webPushError = result.error === 'unauthorized'
            ? 'Сессия истекла. Перезайди и повтори тест.'
            : 'Тестовый push не отправился. Проверь backend логи Web Push.';
          this.pushToast('Web Push', 'Ошибка тестовой отправки');
          return;
        }

        if (result.errorCount > 0) {
          this.webPushSynced = false;
          this.webPushTestStatus = 'Тестовый push отправлен';
          this.webPushError = `Часть подписок не отправилась: ${result.errorCount}/${result.totalSubscriptions}. Смотри backend логи Web Push.`;
          this.pushToast('Web Push', `Тестовый push отправлен, ошибок: ${result.errorCount}`);
          return;
        }

        this.webPushSynced = true;
        this.webPushTestStatus = 'Тестовый push отправлен';
        this.pushToast('Web Push', 'Тестовый push отправлен');
      } catch {
        this.webPushTestStatus = 'Ошибка тестовой отправки';
        this.webPushError = 'Тестовый push не отправился. Проверь backend логи Web Push.';
        this.pushToast('Web Push', 'Ошибка тестовой отправки');
      } finally {
        this.webPushTestBusy = false;
      }
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
