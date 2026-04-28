import {
  nextTick,
  ws,
  restoreSession,
  getSessionToken,
  wsChangePassword,
  wsUpdateProfile,
  wsData,
  wsObject,
  COLOR_HEX_RE,
  HISTORY_BATCH_SIZE,
} from './shared';
import type {
  DiscussionMeta,
  Dialog,
  Message,
  RoomSurface,
  User,
  DirectDialog,
  NotificationItem,
  RouteMode,
} from './shared';
import {resolveMediaUrl} from '@/composables/media-url';
export const chatMethodsAuthDialogsAndProfile = {
    applyMe(this: any, me: User) {
      const normalizedMe = this.normalizeUser(me) || me;
      this.me = normalizedMe;
      this.profileName = normalizedMe.name || normalizedMe.nickname;
      this.profileNicknameColor = normalizedMe.nicknameColor || '';
      this.profileColorPicker = normalizedMe.nicknameColor || '#61afef';
      this.pushDisableAllMentions = !!normalizedMe.pushDisableAllMentions;
    },

    normalizeUser(this: any, raw: any): User | null {
      const id = Number(raw?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return null;
      return {
        id,
        nickname: String(raw?.nickname || '').trim(),
        name: String(raw?.name || raw?.nickname || '').trim(),
        info: raw?.info ? String(raw.info) : null,
        avatarUrl: resolveMediaUrl(raw?.avatarUrl) || null,
        nicknameColor: raw?.nicknameColor ? String(raw.nicknameColor) : null,
        donationBadgeUntil: raw?.donationBadgeUntil ? String(raw.donationBadgeUntil) : null,
        isOnline: !!raw?.isOnline,
        pushDisableAllMentions: !!raw?.pushDisableAllMentions,
      };
    },

    normalizeRoomSurface(this: any, raw: any, fallbackPinnedNodeIdRaw?: unknown): RoomSurface {
      const typeRaw = String(raw?.type || '').trim().toLowerCase();
      const type = typeRaw === 'llm' || typeRaw === 'poll' || typeRaw === 'dashboard' || typeRaw === 'bot_control' || typeRaw === 'custom'
        ? typeRaw
        : null;
      const fallbackPinnedNodeId = Number(fallbackPinnedNodeIdRaw || 0);
      const pinnedNodeId = Number(raw?.pinnedNodeId || fallbackPinnedNodeId || 0);
      const pinnedKindRaw = String(raw?.pinnedKind || '').trim().toLowerCase();
      const pinnedKind = pinnedKindRaw === 'text' || pinnedKindRaw === 'system' || pinnedKindRaw === 'scriptable'
        ? pinnedKindRaw
        : null;
      const config = raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
        ? {...raw.config}
        : {};

      return {
        enabled: !!raw?.enabled,
        type,
        config,
        pinnedNodeId: Number.isFinite(pinnedNodeId) && pinnedNodeId > 0 ? pinnedNodeId : null,
        pinnedKind,
        hasRoomRuntime: !!raw?.hasRoomRuntime,
        requiresRoomRuntime: !!raw?.requiresRoomRuntime,
      };
    },

    normalizeDiscussionMeta(this: any, raw: any): DiscussionMeta | null {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const sourceMessageIdRaw = Number(raw?.sourceMessageId || 0);
      const sourceRoomIdRaw = Number(raw?.sourceRoomId || 0);
      const sourceRoomKindRaw = String(raw?.sourceRoomKind || '').trim().toLowerCase();
      const sourceRoomKind = sourceRoomKindRaw === 'group' || sourceRoomKindRaw === 'direct' || sourceRoomKindRaw === 'game' || sourceRoomKindRaw === 'comment'
        ? sourceRoomKindRaw
        : null;
      const sourceMessageId = Number.isFinite(sourceMessageIdRaw) && sourceMessageIdRaw > 0
        ? sourceMessageIdRaw
        : null;
      const sourceRoomId = Number.isFinite(sourceRoomIdRaw) && sourceRoomIdRaw > 0
        ? sourceRoomIdRaw
        : null;
      const sourceMessageDeleted = !!raw?.sourceMessageDeleted;
      if (!sourceMessageDeleted && !sourceRoomId && !sourceMessageId) return null;

      return {
        sourceMessageId,
        sourceRoomId,
        sourceRoomKind,
        sourceRoomTitle: raw?.sourceRoomTitle ? String(raw.sourceRoomTitle) : null,
        sourceRoomAvatarUrl: resolveMediaUrl(raw?.sourceRoomAvatarUrl) || null,
        sourceMessagePreview: raw?.sourceMessagePreview ? String(raw.sourceMessagePreview) : '',
        sourceMessageDeleted,
      };
    },

    async resolveDiscussionSourceMessage(this: any, discussionRaw: DiscussionMeta | null): Promise<Message | null> {
      const discussion = discussionRaw && typeof discussionRaw === 'object' ? discussionRaw : null;
      if (!discussion || discussion.sourceMessageDeleted) return null;

      const sourceRoomId = Number(discussion.sourceRoomId || 0);
      const sourceMessageId = Number(discussion.sourceMessageId || 0);
      if (!Number.isFinite(sourceRoomId) || sourceRoomId <= 0) return null;
      if (!Number.isFinite(sourceMessageId) || sourceMessageId <= 0) return null;

      const result = await ws.request('message:list', {
        roomId: sourceRoomId,
        beforeMessageId: sourceMessageId + 1,
        limit: 1,
      });
      if (!(result as any)?.ok) return null;

      const rows = wsData<any[]>(result, []);
      const sourceMessageRaw = rows.find((row: any) => Number(row?.id || 0) === sourceMessageId);
      if (!sourceMessageRaw || typeof sourceMessageRaw !== 'object') return null;
      return this.normalizeMessage(sourceMessageRaw);
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

      if (this.activeDialog?.kind === 'direct' && this.activeDialog?.targetUser?.id === user.id) {
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
          authorAvatarUrl: user.avatarUrl || null,
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
      const token = String(getSessionToken() || '').trim();
      if (!token) {
        await this.router.push('/login');
        return false;
      }

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const session = await restoreSession();
        const data = wsObject(session);
        if ((session as any)?.ok && data.user?.id) {
          this.applyMe(data.user as User);
          this.loadHandledMessageNotificationIds();
          return true;
        }

        if ((session as any)?.error === 'unauthorized') {
          await this.router.push('/login');
          return false;
        }

        if (attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
      }

      this.error = 'Связь с сервером недоступна. Проверь интернет, авторизация не сброшена.';
      return false;
    },

    async fetchUsers(this: any) {
      const rows = wsData<any[]>(await ws.request('user:list'), []);
      this.users = rows
        .map((row: any) => this.normalizeUser(row))
        .filter(Boolean) as User[];
    },

    async fetchDirectDialogs(this: any) {
      const rows = wsData<any[]>(await ws.request('room:list', {kind: 'direct'}), []);
      this.directDialogs = rows.map((dialogRaw: any) => ({
        ...dialogRaw,
        targetUser: this.normalizeUser(dialogRaw?.targetUser) || dialogRaw?.targetUser,
        roomSurface: this.normalizeRoomSurface(dialogRaw?.roomSurface, dialogRaw?.pinnedNodeId),
      }));
    },

    async fetchPinnedDirectUserIds(this: any) {
      const rows = wsData<any[]>(await ws.request('contacts:list'), []);
      this.pinnedDirectUserIds = rows
        .map((row: any) => Number(row?.id || 0))
        .filter((id: number) => Number.isFinite(id) && id > 0);
    },

    async fetchRoomsNavigation(this: any) {
      const [joinedResult, publicResult] = await Promise.all([
        ws.request('room:list', {kind: 'group', scope: 'joined'}),
        ws.request('room:list', {kind: 'group', scope: 'public'}),
      ]);

      const normalizeRoomDialog = (dialogRaw: any): Dialog => ({
        id: Number(dialogRaw?.roomId || dialogRaw?.dialogId || 0),
        kind: 'group',
        joined: dialogRaw?.joined !== undefined ? !!dialogRaw.joined : true,
        title: String(dialogRaw?.title || 'Комната'),
        visibility: dialogRaw?.visibility === 'private' ? 'private' : 'public',
        commentsEnabled: dialogRaw?.commentsEnabled !== undefined ? !!dialogRaw.commentsEnabled : true,
        avatarUrl: resolveMediaUrl(dialogRaw?.avatarUrl) || null,
        postOnlyByAdmin: !!dialogRaw?.postOnlyByAdmin,
        createdById: Number(dialogRaw?.createdById || 0) || null,
        pinnedNodeId: Number(dialogRaw?.pinnedNodeId || 0) || null,
        roomSurface: this.normalizeRoomSurface(dialogRaw?.roomSurface, dialogRaw?.pinnedNodeId),
        discussion: null,
      });

      this.joinedRooms = wsData<any[]>(joinedResult, [])
        .map((row: any) => normalizeRoomDialog(row))
        .filter((dialog: Dialog) => Number(dialog.id || 0) > 0);

      const joinedIds = new Set(this.joinedRooms.map((dialog: Dialog) => Number(dialog.id || 0)));
      this.publicRooms = wsData<any[]>(publicResult, [])
        .map((row: any) => normalizeRoomDialog(row))
        .filter((dialog: Dialog) => Number(dialog.id || 0) > 0 && !joinedIds.has(Number(dialog.id || 0)));
    },

    async fetchGeneralDialog(this: any) {
      const result = await ws.request('room:group:get-default');
      if ((result as any)?.error || (result as any)?.ok === false) return null;
      const data = wsObject(result);
      return {
        id: data.roomId,
        kind: 'group',
        joined: data.joined !== undefined ? !!data.joined : true,
        title: data.title,
        visibility: data.visibility === 'private' ? 'private' : 'public',
        commentsEnabled: data.commentsEnabled !== undefined ? !!data.commentsEnabled : true,
        avatarUrl: resolveMediaUrl(data.avatarUrl) || null,
        postOnlyByAdmin: !!data.postOnlyByAdmin,
        createdById: Number(data.createdById || 0) || null,
        pinnedNodeId: Number(data.pinnedNodeId || 0) || null,
        roomSurface: this.normalizeRoomSurface(data.roomSurface, data.pinnedNodeId),
        discussion: null,
      } as Dialog;
    },

    resolveDefaultGroupDialog(this: any): Dialog | null {
      if (Array.isArray(this.joinedRooms) && this.joinedRooms.length > 0) {
        return this.joinedRooms[0] as Dialog;
      }
      if (this.generalDialog) {
        return this.generalDialog as Dialog;
      }
      return null;
    },

    async selectDefaultGroupDialog(this: any, optionsRaw?: {routeMode?: RouteMode; closeMenu?: boolean; haptic?: boolean}) {
      const defaultDialog = this.resolveDefaultGroupDialog();
      if (!defaultDialog) {
        this.activeDialog = null;
        this.setActiveRoomScript(null);
        this.messages = [];
        this.activePinnedMessage = null;
        this.notifyMessagesChanged();
        if (optionsRaw?.closeMenu !== false) {
          this.closeLeftMenu();
        }
        return false;
      }

      if (optionsRaw?.haptic) {
        this.hapticTap();
      }

      await this.selectDialog(defaultDialog, {routeMode: optionsRaw?.routeMode || 'push'});
      if (optionsRaw?.closeMenu !== false) {
        this.closeLeftMenu();
      }
      return true;
    },

    async fetchPrivateDialog(this: any, user: User) {
      const result = await ws.request('room:direct:get-or-create', {userId: user.id});
      if ((result as any)?.error || (result as any)?.ok === false) {
        this.error = 'Не удалось открыть диалог.';
        return null;
      }
      const data = wsObject(result);
      const normalizedTargetUser = this.normalizeUser(data.targetUser) || data.targetUser;
      return {
        id: data.roomId,
        kind: 'direct',
        joined: true,
        targetUser: normalizedTargetUser,
        title: String(normalizedTargetUser?.name || normalizedTargetUser?.nickname || 'Чат'),
        visibility: 'private',
        commentsEnabled: false,
        createdById: null,
        pinnedNodeId: Number(data.pinnedNodeId || 0) || null,
        roomSurface: this.normalizeRoomSurface(data.roomSurface, data.pinnedNodeId),
        discussion: null,
      } as Dialog;
    },

    async loadHistory(this: any, roomId: number, seq: number, beforeMessageId: number | null = null) {
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
        const result = await ws.request('message:list', {
          roomId,
          limit: HISTORY_BATCH_SIZE,
          beforeMessageId,
        });
        if (seq !== this.historyLoadSeq) return;
        const rows = wsData<any[]>(result, []);
        if (!(result as any)?.ok) {
          this.error = 'Не удалось загрузить историю.';
          return;
        }

        const nextChunk = rows.map((message: any) => this.normalizeMessage(message));
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

    async joinDialog(this: any, roomId: number) {
      const result = await ws.request('room:get', {roomId});
      if (!(result as any)?.ok) {
        this.error = 'Не удалось подключиться к диалогу.';
        this.setActiveRoomScript(null);
        this.activePinnedMessage = null;
        return;
      }

      const data = wsObject(result);
      if (this.activeDialog && Number(this.activeDialog.id || 0) === roomId) {
        const joinedKind = String(data.kind || '').trim().toLowerCase();
        const nextKind = joinedKind === 'direct' || joinedKind === 'game'
          ? joinedKind
          : 'group';
        const directTargetUser = this.normalizeUser(data.targetUser) || this.activeDialog?.targetUser || null;
        const resolvedTitle = nextKind === 'direct'
          ? String(directTargetUser?.name || directTargetUser?.nickname || this.activeDialog?.title || 'Чат')
          : (data.title
            ? String(data.title)
            : (this.activeDialog?.title || 'Комната'));
        const nextPinnedNodeId = Number(data.pinnedNodeId || 0) || null;
        this.activeDialog = {
          ...this.activeDialog,
          kind: nextKind,
          joined: data.joined !== undefined ? !!data.joined : (this.activeDialog?.joined !== false),
          title: resolvedTitle,
          visibility: data.visibility === 'private' ? 'private' : (this.activeDialog?.visibility || 'public'),
          commentsEnabled: data.commentsEnabled !== undefined
            ? !!data.commentsEnabled
            : (this.activeDialog?.commentsEnabled !== undefined ? !!this.activeDialog.commentsEnabled : true),
          avatarUrl: resolveMediaUrl(data.avatarUrl) || (this.activeDialog?.avatarUrl || null),
          postOnlyByAdmin: data.postOnlyByAdmin !== undefined
            ? !!data.postOnlyByAdmin
            : !!this.activeDialog?.postOnlyByAdmin,
          createdById: Number(data.createdById || 0) || null,
          pinnedNodeId: nextPinnedNodeId,
          roomSurface: this.normalizeRoomSurface(data.roomSurface, nextPinnedNodeId),
          discussion: this.normalizeDiscussionMeta(data.discussion),
          targetUser: nextKind === 'direct' ? directTargetUser : this.activeDialog?.targetUser,
        };
      }

      this.setActiveRoomScript(data.roomRuntime || null);
      const pinnedMessageRaw = data.pinnedMessage;
      this.activePinnedMessage = pinnedMessageRaw && typeof pinnedMessageRaw === 'object'
        ? this.normalizeMessage(pinnedMessageRaw)
        : null;
      if (!this.activePinnedMessage) {
        const discussionPinnedMessage = await this.resolveDiscussionSourceMessage(this.activeDialog?.discussion || null);
        if (discussionPinnedMessage && Number(this.activeDialog?.id || 0) === roomId) {
          this.activePinnedMessage = discussionPinnedMessage;
        }
      }
      this.pinnedCollapsed = this.loadPinnedCollapsedState(roomId);
    },

    async selectDialog(this: any, dialog: Dialog, optionsRaw?: {routeMode?: RouteMode}) {
      const seq = this.historyLoadSeq + 1;
      this.historyLoadSeq = seq;
      this.dialogSwitching = true;
      this.historyLoading = true;
      this.clearFreshMessageMarks();
      this.activeDialog = dialog;
      this.setActiveRoomScript(null);
      this.messages = [];
      this.activePinnedMessage = null;
      this.pinnedCollapsed = this.loadPinnedCollapsedState(dialog.id);
      this.scriptMessageViewModels = {};
      this.discussionOpenPendingMessageId = null;
      this.roomInviteOpen = false;
      this.roomInviteLoading = false;
      this.roomInviteError = '';
      this.roomInviteSearchQuery = '';
      this.roomInviteSelectedIds = [];
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
      try {
        await this.loadHistory(dialog.id, seq);
        if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

        await this.joinDialog(dialog.id);
        if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

        await this.loadActiveRoomScript(dialog.id);
        if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

        await this.catchUpRoomMessages(dialog.id);
        if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

        await this.syncRouteForDialog(dialog, optionsRaw?.routeMode || 'push');
      } finally {
        if (seq === this.historyLoadSeq) {
          this.dialogSwitching = false;
        }
      }
    },

    async selectGeneral(this: any, optionsRaw?: {routeMode?: RouteMode; closeMenu?: boolean; haptic?: boolean}) {
      if (!this.generalDialog) return;
      if (optionsRaw?.haptic) {
        this.hapticTap();
      }
      await this.selectDialog(this.generalDialog, {routeMode: optionsRaw?.routeMode || 'push'});
      if (optionsRaw?.closeMenu !== false) {
        this.closeLeftMenu();
      }
    },

    async onGoToGeneralChat(this: any) {
      await this.selectGeneral({haptic: true});
    },

    async onOpenVpnPage(this: any) {
      this.hapticTap();
      this.notificationsMenuOpen = false;
      this.leftMenuOpen = false;
      this.rightMenuOpen = false;
      await this.router.push({
        path: '/console',
        query: {
          tab: 'vpn',
        },
      });
    },

    async onOpenOwnProfilePage(this: any) {
      if (!this.me?.nickname) return;
      this.hapticTap();
      this.notificationsMenuOpen = false;
      this.leftMenuOpen = false;
      this.rightMenuOpen = false;
      await this.router.push({
        path: '/console',
        query: {
          tab: 'user',
          nickname: this.me.nickname,
        },
      });
    },

    resolveDialogAvatarUrl(this: any, dialogRaw: Dialog | null) {
      const dialog = dialogRaw || this.activeDialog;
      if (!dialog) return '';
      if (dialog.kind === 'direct') {
        return resolveMediaUrl(dialog.targetUser?.avatarUrl);
      }
      if (dialog.discussion?.sourceRoomAvatarUrl) {
        return resolveMediaUrl(dialog.discussion.sourceRoomAvatarUrl);
      }
      return resolveMediaUrl(dialog.avatarUrl);
    },

    getDialogAvatarFallback(this: any, dialogRaw: Dialog | null) {
      const dialog = dialogRaw || this.activeDialog;
      if (!dialog) return '?';
      if (dialog.kind === 'direct') {
        return ((dialog.targetUser?.name || dialog.targetUser?.nickname || '?').trim().charAt(0) || '?').toUpperCase();
      }
      const sourceTitle = String(dialog.discussion?.sourceRoomTitle || '').trim();
      return ((sourceTitle || dialog.title || 'К').trim().charAt(0) || 'К').toUpperCase();
    },

    async onOpenActiveDialogInfoPage(this: any) {
      if (!this.activeDialog) return;
      this.hapticTap();
      if (this.activeDialog.kind === 'direct' && this.activeDialog?.targetUser?.nickname) {
        await this.router.push({
          path: '/console',
          query: {
            tab: 'user',
            nickname: this.activeDialog.targetUser.nickname,
          },
        });
        return;
      }

      const roomId = Number(this.activeDialog?.discussion?.sourceRoomId || this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      await this.router.push({
        path: '/console',
        query: {
          tab: 'rooms',
          roomId: String(roomId),
        },
      });
    },

    async onPinActiveDialog(this: any) {
      if (!this.activeDialog || this.navPinPending || !this.canPinActiveDialog) return;
      this.hapticTap();
      this.navPinPending = true;
      this.error = '';

      try {
        if (this.activeDialog.kind === 'direct') {
          const userId = Number(this.activeDialog?.targetUser?.id || 0);
          if (!Number.isFinite(userId) || userId <= 0) return;
          const result = await ws.request('contacts:add', {userId});
          if (!(result as any)?.ok) {
            this.error = 'Не удалось закрепить директ.';
            return;
          }
          await this.fetchPinnedDirectUserIds();
          this.pushToast('Директ', 'Добавлен в контакты');
          return;
        }

        const roomId = Number(this.activeDialog.id || 0);
        if (!Number.isFinite(roomId) || roomId <= 0) return;
        const result = await ws.request('room:join', {roomId});
        if (!(result as any)?.ok) {
          this.error = 'Не удалось закрепить комнату.';
          return;
        }
        if (this.activeDialog?.id === roomId) {
          this.activeDialog = {
            ...this.activeDialog,
            joined: true,
          };
        }
        await this.fetchRoomsNavigation();
        this.pushToast('Комната', 'Добавлена в навигацию');
      } finally {
        this.navPinPending = false;
      }
    },

    async selectPrivate(this: any, user: User, optionsRaw?: {routeMode?: RouteMode; closeMenu?: boolean; refreshDirects?: boolean; haptic?: boolean}) {
      if (optionsRaw?.haptic) {
        this.hapticTap();
      }
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
      await this.selectPrivate(user, {haptic: true});
    },

    async selectDirectDialog(this: any, dialog: DirectDialog) {
      this.hapticTap();
      const roomId = Number(dialog?.roomId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) {
        await this.selectPrivate(dialog.targetUser, {
          routeMode: 'push',
          closeMenu: true,
          refreshDirects: true,
        });
        return;
      }

      await this.selectDialog({
        id: roomId,
        kind: 'direct',
        joined: true,
        targetUser: dialog.targetUser,
        title: dialog.targetUser.name,
        visibility: 'private',
        commentsEnabled: false,
        createdById: null,
        pinnedNodeId: Number(dialog.pinnedNodeId || 0) || null,
        roomSurface: this.normalizeRoomSurface(dialog?.roomSurface, dialog?.pinnedNodeId),
        discussion: null,
      }, {routeMode: 'push'});
      this.closeLeftMenu();
    },

    onChatRoomUpdated(this: any, payloadRaw: any) {
      const roomId = Number(payloadRaw?.roomId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      if (Number(this.activeDialog?.id || 0) !== roomId) return;

      const roomKindRaw = String(payloadRaw?.kind || '').trim().toLowerCase();
      const roomKind = roomKindRaw === 'direct' || roomKindRaw === 'game'
        ? roomKindRaw
        : 'group';
      const directTargetUser = this.normalizeUser(payloadRaw?.targetUser) || this.activeDialog?.targetUser || null;
      const pinnedNodeId = Number(payloadRaw?.pinnedNodeId || 0) || null;
      const hasDiscussionPayload = Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'discussion');
      const discussion = hasDiscussionPayload
        ? this.normalizeDiscussionMeta(payloadRaw?.discussion)
        : (this.activeDialog?.discussion || null);
      this.activeDialog = {
        ...this.activeDialog,
        kind: roomKind,
        joined: payloadRaw?.joined !== undefined
          ? !!payloadRaw.joined
          : (roomKind === 'direct' ? true : (this.activeDialog?.joined !== false)),
        title: roomKind === 'direct'
          ? String(directTargetUser?.name || directTargetUser?.nickname || payloadRaw?.title || this.activeDialog?.title || 'Чат')
          : (payloadRaw?.title
            ? String(payloadRaw.title)
            : (this.activeDialog?.title || 'Комната')),
        visibility: payloadRaw?.visibility === 'private' ? 'private' : (this.activeDialog?.visibility || 'public'),
        commentsEnabled: payloadRaw?.commentsEnabled !== undefined
          ? !!payloadRaw.commentsEnabled
          : (this.activeDialog?.commentsEnabled !== undefined ? !!this.activeDialog.commentsEnabled : true),
        avatarUrl: resolveMediaUrl(payloadRaw?.avatarUrl) || (this.activeDialog?.avatarUrl || null),
        postOnlyByAdmin: payloadRaw?.postOnlyByAdmin !== undefined
          ? !!payloadRaw.postOnlyByAdmin
          : !!this.activeDialog?.postOnlyByAdmin,
        createdById: Number(payloadRaw?.createdById || 0) || null,
        pinnedNodeId,
        roomSurface: this.normalizeRoomSurface(payloadRaw?.roomSurface, pinnedNodeId),
        discussion,
        targetUser: roomKind === 'direct' ? directTargetUser : this.activeDialog?.targetUser,
      };
      if (Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'roomRuntime')) {
        this.setActiveRoomScript(payloadRaw?.roomRuntime || null);
      }
      void this.fetchRoomsNavigation();
    },

    async onDeleteActiveRoom(this: any) {
      if (!this.activeDialog?.id) return;
      if (this.roomDeletePending) return;
      if (this.activeDialog.kind !== 'direct' && !this.isActiveDialogAdmin) return;

      this.hapticTap();
      const confirmText = this.activeDialog.kind === 'direct'
        ? 'Очистить переписку? Сообщения будут удалены для обоих участников. Диалог останется доступен.'
        : 'Удалить комнату полностью? Это удалит всю переписку у всех участников.';
      if (!window.confirm(confirmText)) return;

      this.roomDeletePending = true;
      try {
        const roomId = this.activeDialog.id;
        const roomKind = this.activeDialog.kind;
        const result = await ws.request('room:delete', {roomId, confirm: true});
        if (!(result as any)?.ok) {
          this.error = roomKind === 'direct'
            ? 'Не удалось очистить переписку.'
            : 'Не удалось удалить комнату.';
          return;
        }
        if (roomKind === 'direct') {
          await this.onRoomMessagesCleared({
            roomId,
            dialogId: roomId,
            kind: 'direct',
          });
          return;
        }

        await this.onDialogDeleted({roomId});
      } finally {
        this.roomDeletePending = false;
      }
    },

    toggleLeftMenu(this: any) {
      this.hapticTap();
      this.leftMenuOpen = !this.leftMenuOpen;
      if (this.leftMenuOpen) {
        this.rightMenuOpen = false;
        this.notificationsMenuOpen = false;
        void this.fetchRoomsNavigation();
      }
    },

    closeLeftMenu(this: any) {
      this.leftMenuOpen = false;
    },

    onCloseLeftMenuClick(this: any) {
      this.hapticTap();
      this.closeLeftMenu();
    },

    async selectRoomDialog(this: any, dialogRaw: Dialog) {
      const dialog: Dialog = {
        ...dialogRaw,
        kind: 'group',
        joined: true,
        visibility: dialogRaw?.visibility === 'private' ? 'private' : 'public',
        commentsEnabled: dialogRaw?.commentsEnabled !== undefined ? !!dialogRaw.commentsEnabled : true,
        avatarUrl: resolveMediaUrl(dialogRaw?.avatarUrl) || null,
        postOnlyByAdmin: !!dialogRaw?.postOnlyByAdmin,
        roomSurface: this.normalizeRoomSurface(dialogRaw?.roomSurface, dialogRaw?.pinnedNodeId),
        discussion: null,
      };
      await this.selectDialog(dialog, {routeMode: 'push'});
      this.closeLeftMenu();
    },

    async createRoom(this: any) {
      if (this.roomCreating) return;
      this.roomCreating = true;
      this.error = '';

      try {
        const result = await ws.request('room:create', {
          title: String(this.roomCreateTitle || '').trim() || 'Комната',
          visibility: this.roomCreateVisibility === 'private' ? 'private' : 'public',
          commentsEnabled: !!this.roomCreateCommentsEnabled,
        });
        if (!(result as any)?.ok) {
          this.error = 'Не удалось создать комнату.';
          return;
        }

        const data = wsObject(result);
        const dialog: Dialog = {
          id: Number(data.roomId || 0),
          kind: 'group',
          joined: true,
          title: String(data.title || 'Комната'),
          visibility: data.visibility === 'private' ? 'private' : 'public',
          commentsEnabled: data.commentsEnabled !== undefined ? !!data.commentsEnabled : true,
          avatarUrl: resolveMediaUrl(data.avatarUrl) || null,
          postOnlyByAdmin: !!data.postOnlyByAdmin,
          createdById: Number(data.createdById || 0) || null,
          pinnedNodeId: Number(data.pinnedNodeId || 0) || null,
          roomSurface: this.normalizeRoomSurface(data.roomSurface, data.pinnedNodeId),
          discussion: null,
        };
        this.roomCreateTitle = '';
        this.roomCreateVisibility = 'public';
        this.roomCreateCommentsEnabled = true;
        await this.fetchRoomsNavigation();
        await this.selectRoomDialog(dialog);
      } finally {
        this.roomCreating = false;
      }
    },

    async joinPublicRoom(this: any, dialogRaw: Dialog) {
      const roomId = Number(dialogRaw?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;

      const result = await ws.request('room:join', {roomId});
      if (!(result as any)?.ok) {
        this.error = 'Не удалось войти в комнату.';
        return;
      }

      await this.fetchRoomsNavigation();
      await this.selectRoomDialog(dialogRaw);
    },

    async loadRoomInviteContacts(this: any) {
      const rows = wsData<any[]>(await ws.request('contacts:list'), []);
      this.roomInviteContacts = rows
        .map((row: any) => this.normalizeUser(row))
        .filter(Boolean) as User[];
      this.pinnedDirectUserIds = rows
        .map((row: any) => Number(row?.id || 0))
        .filter((id: number) => Number.isFinite(id) && id > 0);
    },

    async toggleRoomInvitePanel(this: any) {
      if (!this.activeDialog?.id || !this.isActiveDialogAdmin || this.activeDialog.kind === 'direct') return;
      this.roomInviteOpen = !this.roomInviteOpen;
      this.roomInviteError = '';
      if (!this.roomInviteOpen) return;

      this.roomInviteLoading = true;
      try {
        await this.loadRoomInviteContacts();
        this.roomInviteSelectedIds = [];
        this.roomInviteSearchQuery = '';
      } finally {
        this.roomInviteLoading = false;
      }
    },

    toggleRoomInviteSelection(this: any, userIdRaw: unknown) {
      const userId = Number(userIdRaw || 0);
      if (!Number.isFinite(userId) || userId <= 0) return;
      const current = new Set((this.roomInviteSelectedIds || []).map((value: number) => Number(value || 0)));
      if (current.has(userId)) {
        current.delete(userId);
      } else {
        current.add(userId);
      }
      this.roomInviteSelectedIds = Array.from(current);
    },

    isRoomInviteSelected(this: any, userIdRaw: unknown) {
      const userId = Number(userIdRaw || 0);
      if (!Number.isFinite(userId) || userId <= 0) return false;
      return (this.roomInviteSelectedIds || []).includes(userId);
    },

    async submitRoomInvite(this: any) {
      if (!this.activeDialog?.id || !this.roomInviteSelectedIds.length) return;
      this.roomInviteLoading = true;
      this.roomInviteError = '';

      try {
        const result = await ws.request('room:members:add', {
          roomId: this.activeDialog.id,
          userIds: this.roomInviteSelectedIds,
        });
        if (!(result as any)?.ok) {
          this.roomInviteError = 'Не удалось добавить пользователей.';
          return;
        }

        this.roomInviteSelectedIds = [];
        this.roomInviteOpen = false;
        this.pushToast('Комната', 'Пользователи добавлены');
      } finally {
        this.roomInviteLoading = false;
      }
    },

    toggleRightMenu(this: any) {
      this.hapticTap();
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

    onCloseRightMenuClick(this: any) {
      this.hapticTap();
      this.closeRightMenu();
    },

    clearNicknameColor(this: any) {
      this.hapticTap();
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
        this.hapticError();
        return;
      }

      const normalizedColor = this.normalizeColor(this.profileNicknameColor);
      if (normalizedColor && !COLOR_HEX_RE.test(normalizedColor)) {
        this.profileError = 'Цвет должен быть в формате #RRGGBB.';
        this.hapticError();
        return;
      }

      this.profileSaving = true;
      this.profileError = '';

      try {
        const profileResult = await wsUpdateProfile({
          name,
          nicknameColor: normalizedColor || null,
          pushDisableAllMentions: !!this.pushDisableAllMentions,
        });

        if (!(profileResult as any)?.ok) {
          const code = (profileResult as any)?.error || 'unknown';
          if (code === 'unauthorized') {
            await this.router.push('/login');
            return;
          }
          this.profileError = 'Не удалось сохранить профиль.';
          this.hapticError();
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
              this.hapticError();
              return;
            }
            this.profileError = 'Не удалось сменить пароль.';
            this.hapticError();
            return;
          }
        }

        this.newPassword = '';
        this.rightMenuOpen = false;
        this.hapticConfirm();
      } catch {
        this.profileError = 'Сервер недоступен.';
        this.hapticError();
      } finally {
        this.profileSaving = false;
      }
    },

};
