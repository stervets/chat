import {
  BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  HANDLED_MESSAGE_IDS_LIMIT,
  SOUND_ENABLED_STORAGE_KEY,
  VIBRATION_ENABLED_STORAGE_KEY,
  getHandledMessageIdsStorageKey,
  loadBooleanSetting,
  loadHandledMessageIds,
  normalizeHandledMessageIdsMap,
  persistBooleanSetting,
  persistHandledMessageIds,
  HANDLED_MESSAGE_IDS_SAVE_DELAY_MS,
  INCOMING_CALL_SOUND_VOLUME,
  NOTIFICATION_SOUND_VOLUME,
} from './shared';
import type {
  Dialog,
  User,
  DirectDialog,
  RouteMode,
  SoundRuntimeState,
} from './shared';
import {isNativeAndroidApp} from '@/composables/native-runtime';
import {loadLastChatPath, persistLastChatPath} from '@/composables/last-chat';
import {SoundPlayer} from '@/composables/classes/sound-player';
import {vibrateConfirm, vibrateError, vibrateTap} from '@/utils/vibrate';

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

    loadVibrationEnabledSetting(this: any) {
      this.vibrationEnabled = loadBooleanSetting(VIBRATION_ENABLED_STORAGE_KEY, true);
    },

    persistVibrationEnabledSetting(this: any) {
      persistBooleanSetting(VIBRATION_ENABLED_STORAGE_KEY, !!this.vibrationEnabled);
    },

    hapticTap(this: any) {
      if (!this.vibrationEnabled) return;
      vibrateTap();
    },

    hapticConfirm(this: any) {
      if (!this.vibrationEnabled) return;
      vibrateConfirm();
    },

    hapticError(this: any) {
      if (!this.vibrationEnabled) return;
      vibrateError();
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

    ensureNotificationSoundPlayer(this: any) {
      if (typeof window === 'undefined') return null;
      if (this.notificationSoundPlayer) return this.notificationSoundPlayer as SoundPlayer;

      const soundPlayer = new SoundPlayer();
      this.notificationSoundPlayer = soundPlayer;
      return soundPlayer;
    },

    markSoundReady(this: any) {
      if (!this.soundEnabled) return;
      this.soundReady = true;
      const runtime = this.getSoundRuntimeState();
      runtime.soundReady = true;
      runtime.overlayHandled = true;
      this.ensureNotificationSoundPlayer();
      if (this.callPhase === 'outgoing') {
        void this.playOutgoingCallMusic();
      }
    },

    resolveSoundStartupState(this: any) {
      const runtime = this.getSoundRuntimeState();
      this.loadSoundEnabledSetting();
      this.loadVibrationEnabledSetting();
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

    async playSoundEffect(this: any, soundName: string, volume: number, loop = false) {
      if (!this.soundEnabled || !this.soundReady) return;

      const soundPlayer = this.ensureNotificationSoundPlayer();
      if (!soundPlayer) return;

      try {
        if (!soundPlayer.isReady) {
          await soundPlayer.preloadPromise;
        }
        if (loop) {
          await soundPlayer.playLoop(soundName, volume);
        } else {
          await soundPlayer.play(soundName, volume);
        }
      } catch {
        this.notificationSoundPlayer = null;
      }
    },

    playNotificationSound(this: any) {
      return this.playSoundEffect('notification', NOTIFICATION_SOUND_VOLUME);
    },

    playIncomingCallSound(this: any) {
      return this.playSoundEffect('incomingCall', INCOMING_CALL_SOUND_VOLUME, true);
    },

    stopIncomingCallSound(this: any) {
      const soundPlayer = this.notificationSoundPlayer;
      if (!soundPlayer) return;
      soundPlayer.stopLoop('incomingCall');
    },

    playCallOnSound(this: any) {
      return this.playSoundEffect('callOn', NOTIFICATION_SOUND_VOLUME);
    },

    playCallOffSound(this: any) {
      return this.playSoundEffect('callOff', NOTIFICATION_SOUND_VOLUME);
    },

    async playOutgoingCallMusic(this: any) {
      if (typeof window === 'undefined') return;
      if (!this.soundEnabled || !this.soundReady) return;

      let audio = this.outgoingCallMusicAudio as HTMLAudioElement | null;
      if (!audio) {
        audio = new Audio('/callout.mp3');
        audio.preload = 'auto';
        audio.loop = true;
        audio.volume = NOTIFICATION_SOUND_VOLUME;
        this.outgoingCallMusicAudio = audio;
      }
      audio.volume = NOTIFICATION_SOUND_VOLUME;
      if (!audio.paused) return;
      try {
        await audio.play();
      } catch {}
    },

    stopOutgoingCallMusic(this: any) {
      const audio = this.outgoingCallMusicAudio as HTMLAudioElement | null;
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
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
        this.stopIncomingCallSound();
        this.stopOutgoingCallMusic();
        this.soundOverlayVisible = false;
        this.soundReady = false;
        runtime.overlayHandled = true;
        runtime.soundReady = false;
        return;
      }
      runtime.overlayHandled = true;
      this.markSoundReady();
    },

    onVibrationEnabledChange(this: any) {
      this.vibrationEnabled = !!this.vibrationEnabled;
      this.persistVibrationEnabledSetting();
      this.hapticTap();
    },

    isBrowserNotificationsSupported(this: any) {
      if (isNativeAndroidApp()) return false;
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

    initBrowserNotifications(this: any) {
      this.loadBrowserNotificationsEnabledSetting();
      this.syncBrowserNotificationPermission();
    },

    normalizeRouteNickname(this: any, nicknameRaw: unknown) {
      return String(nicknameRaw || '').trim().toLowerCase();
    },

    normalizeRoutePath(this: any, pathRaw: unknown) {
      const rawPath = String(pathRaw || '').trim();
      if (!rawPath) return '/';
      if (rawPath === '/') return '/';
      return rawPath.replace(/\/+$/, '') || '/';
    },

    isChatRoutePath(this: any, pathRaw: unknown) {
      return this.normalizeRoutePath(pathRaw) === '/chat';
    },

    buildDirectRoutePath(this: any, nicknameRaw: unknown) {
      const nickname = this.normalizeRouteNickname(nicknameRaw);
      if (!nickname) return '/chat';
      return `/direct/${encodeURIComponent(nickname)}`;
    },

    parseRoutePositiveInt(this: any, raw: unknown) {
      const parsed = Number.parseInt(String(raw ?? ''), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return parsed;
    },

    getRoomRouteContext(this: any) {
      const roomRaw = Array.isArray(this.route?.query?.room)
        ? this.route.query.room[0]
        : this.route?.query?.room;
      const sourceRoomRaw = Array.isArray(this.route?.query?.sourceRoom)
        ? this.route.query.sourceRoom[0]
        : this.route?.query?.sourceRoom;
      const sourceMessageRaw = Array.isArray(this.route?.query?.sourceMessage)
        ? this.route.query.sourceMessage[0]
        : this.route?.query?.sourceMessage;
      const focusMessageRaw = Array.isArray(this.route?.query?.focusMessage)
        ? this.route.query.focusMessage[0]
        : this.route?.query?.focusMessage;

      return {
        roomId: this.parseRoutePositiveInt(roomRaw),
        sourceRoomId: this.parseRoutePositiveInt(sourceRoomRaw),
        sourceMessageId: this.parseRoutePositiveInt(sourceMessageRaw),
        focusMessageId: this.parseRoutePositiveInt(focusMessageRaw),
      };
    },

    buildRoomRoutePath(this: any, roomIdRaw: unknown, contextRaw?: {
      sourceRoomId?: number | null;
      sourceMessageId?: number | null;
      focusMessageId?: number | null;
    }) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return '/chat';

      const sourceRoomId = Number(contextRaw?.sourceRoomId || 0);
      const sourceMessageId = Number(contextRaw?.sourceMessageId || 0);
      const focusMessageId = Number(contextRaw?.focusMessageId || 0);
      const query = new URLSearchParams();
      query.set('room', String(roomId));
      if (Number.isFinite(sourceRoomId) && sourceRoomId > 0) {
        query.set('sourceRoom', String(sourceRoomId));
      }
      if (Number.isFinite(sourceMessageId) && sourceMessageId > 0) {
        query.set('sourceMessage', String(sourceMessageId));
      }
      if (Number.isFinite(focusMessageId) && focusMessageId > 0) {
        query.set('focusMessage', String(focusMessageId));
      }
      return `/chat?${query.toString()}`;
    },

    safeDecodeRouteParam(this: any, valueRaw: unknown) {
      const value = String(valueRaw || '');
      if (!value) return '';
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    },

    getDirectNicknameFromRoute(this: any) {
      const path = String(this.route?.path || '');
      if (!path.startsWith('/direct/')) return '';

      const raw = Array.isArray(this.route?.params?.username)
        ? this.route.params.username[0]
        : this.route?.params?.username;
      const fallbackFromPath = path.slice('/direct/'.length).split('/')[0] || '';
      const decoded = this.safeDecodeRouteParam(raw || fallbackFromPath);
      return this.normalizeRouteNickname(decoded);
    },

    getRoomIdFromRoute(this: any) {
      if (!this.isChatRoutePath(this.route?.path)) return null;
      return this.getRoomRouteContext().roomId;
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

    isOwnDirectNickname(this: any, nicknameRaw: unknown) {
      const nickname = this.normalizeRouteNickname(nicknameRaw);
      const meNickname = this.normalizeRouteNickname(this.me?.nickname);
      return !!nickname && !!meNickname && nickname === meNickname;
    },

    isSelfDirectPath(this: any, pathRaw: unknown) {
      const path = String(pathRaw || '').trim();
      if (!path.startsWith('/direct/')) return false;
      const nicknamePart = path.slice('/direct/'.length).split(/[?#]/, 1)[0] || '';
      const decoded = this.safeDecodeRouteParam(nicknamePart);
      return this.isOwnDirectNickname(decoded);
    },

    findDirectDialogByRoomId(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return null;
      return this.directDialogs.find((dialog: DirectDialog) => Number(dialog.roomId || 0) === roomId) || null;
    },

    buildDialogFromRoomRoute(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return null;

      const generalRoomId = Number(this.generalDialog?.id || 0);
      if (generalRoomId > 0 && roomId === generalRoomId && this.generalDialog) {
        return this.generalDialog as Dialog;
      }

      const fromJoined = Array.isArray(this.joinedRooms)
        ? this.joinedRooms.find((dialog: Dialog) => Number(dialog?.id || 0) === roomId)
        : null;
      if (fromJoined) {
        return {
          ...fromJoined,
        } as Dialog;
      }

      const fromPublic = Array.isArray(this.publicRooms)
        ? this.publicRooms.find((dialog: Dialog) => Number(dialog?.id || 0) === roomId)
        : null;
      if (fromPublic) {
        return {
          ...fromPublic,
        } as Dialog;
      }

      const direct = this.findDirectDialogByRoomId(roomId);
      if (direct) {
        return {
          id: direct.roomId,
          kind: 'direct',
          joined: true,
          targetUser: direct.targetUser,
          title: direct.targetUser.name,
          createdById: null,
          pinnedNodeId: Number(direct.pinnedNodeId || 0) || null,
          discussion: null,
        } as Dialog;
      }

      return {
        id: roomId,
        kind: 'group',
        joined: false,
        title: `Комната #${roomId}`,
        createdById: null,
        pinnedNodeId: null,
        discussion: null,
      } as Dialog;
    },

    async syncRouteForDialog(this: any, dialog: Dialog, modeRaw?: RouteMode) {
      const mode = modeRaw || 'push';
      if (mode === 'none') return;

      const targetPath = this.buildRoomRoutePath(dialog.id);
      const currentFullPath = String(this.route?.fullPath || this.route?.path || '');
      if (currentFullPath === targetPath) {
        persistLastChatPath(targetPath);
        return;
      }

      if (mode === 'replace') {
        await this.router.replace(targetPath);
        persistLastChatPath(targetPath);
        return;
      }
      await this.router.push(targetPath);
      persistLastChatPath(targetPath);
    },

    async syncDialogFromRoute(this: any, optionsRaw?: {replaceInvalid?: boolean}) {
      const replaceInvalid = optionsRaw?.replaceInvalid !== false;
      const directNickname = this.getDirectNicknameFromRoute();
      if (directNickname) {
        const targetUser = this.findUserByNickname(directNickname);
        if (!targetUser || targetUser.id === this.me?.id) {
          persistLastChatPath('/chat');
          if (replaceInvalid) {
            await this.router.replace('/chat');
          }
          await this.selectDefaultGroupDialog({routeMode: 'none', closeMenu: false});
          return;
        }

        const existingDirect = (this.directDialogs || []).find((dialog: DirectDialog) => {
          return Number(dialog?.targetUser?.id || 0) === Number(targetUser.id || 0)
            && Number(dialog?.roomId || 0) > 0;
        }) || null;
        if (existingDirect) {
          await this.selectDialog({
            id: existingDirect.roomId,
            kind: 'direct',
            joined: true,
            targetUser: existingDirect.targetUser,
            title: existingDirect.targetUser.name,
            visibility: 'private',
            commentsEnabled: false,
            createdById: null,
            pinnedNodeId: Number(existingDirect.pinnedNodeId || 0) || null,
            discussion: null,
          }, {routeMode: 'none'});
        } else {
          await this.selectPrivate(targetUser, {
            routeMode: 'none',
            closeMenu: false,
            refreshDirects: false,
          });
        }

        const canonicalPath = this.buildDirectRoutePath(targetUser.nickname);
        if (String(this.route?.path || '') !== canonicalPath) {
          await this.router.replace(canonicalPath);
        }
        persistLastChatPath(canonicalPath);
        return;
      }

      const roomIdFromRoute = this.getRoomIdFromRoute();
      if (!roomIdFromRoute) {
        const lastPath = loadLastChatPath();
        if (replaceInvalid && this.isSelfDirectPath(lastPath)) {
          persistLastChatPath('/chat');
        } else if (replaceInvalid && lastPath && lastPath !== '/chat' && this.isChatRoutePath(this.route?.path)) {
          await this.router.replace(lastPath);
          return;
        }

        const selected = await this.selectDefaultGroupDialog({routeMode: 'none', closeMenu: false});
        if (!selected) {
          if (replaceInvalid && !this.isChatRoutePath(this.route?.path)) {
            await this.router.replace('/chat');
          }
          persistLastChatPath('/chat');
          return;
        }

        const selectedRoomId = Number(this.activeDialog?.id || 0);
        if (!Number.isFinite(selectedRoomId) || selectedRoomId <= 0) {
          persistLastChatPath('/chat');
          return;
        }

        const canonicalPath = this.buildRoomRoutePath(selectedRoomId);
        if (replaceInvalid && String(this.route?.fullPath || this.route?.path || '') !== canonicalPath) {
          await this.router.replace(canonicalPath);
        }
        persistLastChatPath(canonicalPath);
        const focusMessageId = Number(this.getRoomRouteContext().focusMessageId || 0);
        if (Number.isFinite(focusMessageId) && focusMessageId > 0) {
          void this.scrollToMessageById(focusMessageId);
        }
        return;
      }

      const roomDialog = this.buildDialogFromRoomRoute(roomIdFromRoute);
      if (!roomDialog) {
        await this.selectDefaultGroupDialog({routeMode: 'none', closeMenu: false});
        if (replaceInvalid) await this.router.replace('/chat');
        return;
      }

      await this.selectDialog(roomDialog, {routeMode: 'none'});

      if (this.error) {
        await this.selectDefaultGroupDialog({routeMode: 'none', closeMenu: false});
        if (replaceInvalid) await this.router.replace('/chat');
        return;
      }

      if (roomDialog.kind !== 'direct') {
        const routeContext = this.getRoomRouteContext();
        const canonicalPath = this.buildRoomRoutePath(roomDialog.id, {
          sourceRoomId: routeContext.sourceRoomId,
          sourceMessageId: routeContext.sourceMessageId,
          focusMessageId: routeContext.focusMessageId,
        });
        if (String(this.route?.fullPath || this.route?.path || '') !== canonicalPath) {
          await this.router.replace(canonicalPath);
        }
        persistLastChatPath(canonicalPath);
      }

      const focusMessageId = Number(this.getRoomRouteContext().focusMessageId || 0);
      if (Number.isFinite(focusMessageId) && focusMessageId > 0) {
        void this.scrollToMessageById(focusMessageId);
      }
    },

    async onRouteChanged(this: any) {
      if (!this.routeSyncReady) return;

      const path = String(this.route?.path || '');
      if (this.isChatRoutePath(path)) {
        const roomIdFromRoute = this.getRoomIdFromRoute();
        if (!roomIdFromRoute) {
          const defaultDialog = this.resolveDefaultGroupDialog();
          if (!defaultDialog) {
            await this.selectDefaultGroupDialog({routeMode: 'none', closeMenu: false});
            return;
          }
          const canonicalPath = this.buildRoomRoutePath(defaultDialog.id);
          if (String(this.route?.fullPath || this.route?.path || '') !== canonicalPath) {
            await this.router.replace(canonicalPath);
            persistLastChatPath(canonicalPath);
            return;
          }
          if (this.activeDialog?.kind === 'group' && Number(this.activeDialog?.id || 0) === Number(defaultDialog.id || 0)) {
            return;
          }
          await this.selectDialog(defaultDialog, {routeMode: 'none'});
          return;
        }

        if (Number(this.activeDialog?.id || 0) === roomIdFromRoute) {
          return;
        }

        const roomDialog = this.buildDialogFromRoomRoute(roomIdFromRoute);
        if (!roomDialog) {
          const selected = await this.selectDefaultGroupDialog({routeMode: 'replace', closeMenu: false});
          if (!selected) {
            await this.router.replace('/chat');
          }
          return;
        }

        await this.selectDialog(roomDialog, {
          routeMode: 'none',
        });
        if (this.error) {
          const selected = await this.selectDefaultGroupDialog({routeMode: 'replace', closeMenu: false});
          if (!selected) {
            await this.router.replace('/chat');
          }
        }
        return;
      }

      const directNickname = this.getDirectNicknameFromRoute();
      if (!directNickname) return;

      if (
        this.activeDialog?.kind === 'direct'
        && this.normalizeRouteNickname(this.activeDialog?.targetUser?.nickname) === directNickname
      ) {
        return;
      }

      const targetUser = this.findUserByNickname(directNickname);
      if (!targetUser || targetUser.id === this.me?.id) {
        persistLastChatPath('/chat');
        const selected = await this.selectDefaultGroupDialog({routeMode: 'replace', closeMenu: false});
        if (!selected) {
          await this.router.replace('/chat');
        }
        return;
      }

      const existingDirect = (this.directDialogs || []).find((dialog: DirectDialog) => {
        return Number(dialog?.targetUser?.id || 0) === Number(targetUser.id || 0)
          && Number(dialog?.roomId || 0) > 0;
      }) || null;
      if (existingDirect) {
        await this.selectDialog({
          id: existingDirect.roomId,
          kind: 'direct',
          joined: true,
          targetUser: existingDirect.targetUser,
          title: existingDirect.targetUser.name,
          visibility: 'private',
          commentsEnabled: false,
          createdById: null,
          pinnedNodeId: Number(existingDirect.pinnedNodeId || 0) || null,
          discussion: null,
        }, {routeMode: 'none'});
        return;
      }

      await this.selectPrivate(targetUser, {
        routeMode: 'none',
        closeMenu: false,
        refreshDirects: false,
      });
    },

};
