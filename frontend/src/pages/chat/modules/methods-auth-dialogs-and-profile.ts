import {
  nextTick,
  ws,
  restoreSession,
  getSessionToken,
  wsChangePassword,
  wsUpdateProfile,
  COLOR_HEX_RE,
  HISTORY_BATCH_SIZE,
} from './shared';
import type {
  Dialog,
  Message,
  User,
  DirectDialog,
  NotificationItem,
  RouteMode,
} from './shared';
export const chatMethodsAuthDialogsAndProfile = {
    applyMe(this: any, me: User) {
      this.me = me;
      this.profileName = me.name || me.nickname;
      this.profileNicknameColor = me.nicknameColor || '';
      this.profileColorPicker = me.nicknameColor || '#61afef';
      this.pushDisableAllMentions = !!me.pushDisableAllMentions;
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
        pushDisableAllMentions: !!raw?.pushDisableAllMentions,
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
        if ((session as any)?.ok && (session as any)?.user?.id) {
          this.applyMe((session as any).user as User);
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
        id: (result as any).roomId,
        kind: 'group',
        title: (result as any).title,
        createdById: Number((result as any).createdById || 0) || null,
        pinnedMessageId: Number((result as any).pinnedMessageId || 0) || null,
      } as Dialog;
    },

    async fetchPrivateDialog(this: any, user: User) {
      const result = await ws.request('dialogs:private', user.id);
      if ((result as any)?.error || (result as any)?.ok === false) {
        this.error = 'Не удалось открыть диалог.';
        return null;
      }
      return {
        id: (result as any).roomId,
        kind: 'direct',
        targetUser: (result as any).targetUser,
        title: (result as any).targetUser.name,
        createdById: null,
        pinnedMessageId: Number((result as any).pinnedMessageId || 0) || null,
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
        const result = await ws.request('dialogs:messages', roomId, HISTORY_BATCH_SIZE, beforeMessageId);
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

    async joinDialog(this: any, roomId: number) {
      const result = await ws.request('chat:join', roomId);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось подключиться к диалогу.';
        this.setActiveRoomScript(null);
        this.activePinnedMessage = null;
        return;
      }

      if (this.activeDialog && Number(this.activeDialog.id || 0) === roomId) {
        this.activeDialog = {
          ...this.activeDialog,
          kind: String((result as any).kind || this.activeDialog.kind) === 'direct'
            ? 'direct'
            : this.activeDialog.kind,
          createdById: Number((result as any).createdById || 0) || null,
        };
      }

      this.setActiveRoomScript((result as any).roomScript || null);
      const pinnedMessageRaw = (result as any).pinnedMessage;
      this.activePinnedMessage = pinnedMessageRaw && typeof pinnedMessageRaw === 'object'
        ? this.normalizeMessage(pinnedMessageRaw)
        : null;
      this.syncPinnedHiddenStateByPayload({
        roomId,
        pinnedMessageId: Number((result as any).pinnedMessageId || 0) || null,
      });
    },

    async selectDialog(this: any, dialog: Dialog, optionsRaw?: {routeMode?: RouteMode}) {
      const seq = this.historyLoadSeq + 1;
      this.historyLoadSeq = seq;
      this.clearFreshMessageMarks();
      this.activeDialog = dialog;
      this.setActiveRoomScript(null);
      this.messages = [];
      this.activePinnedMessage = null;
      this.pinnedCollapsed = false;
      this.scriptMessageViewModels = {};
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
      if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

      await this.joinDialog(dialog.id);
      if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

      await this.loadActiveRoomScript(dialog.id);
      if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

      await this.catchUpRoomMessages(dialog.id);
      if (seq !== this.historyLoadSeq || this.activeDialog?.id !== dialog.id) return;

      await this.syncRouteForDialog(dialog, optionsRaw?.routeMode || 'push');
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
      await this.router.push('/vpn');
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
      await this.selectDialog({
        id: dialog.roomId,
        kind: 'direct',
        targetUser: dialog.targetUser,
        title: dialog.targetUser.name,
        createdById: null,
        pinnedMessageId: Number(dialog.pinnedMessageId || 0) || null,
      }, {routeMode: 'push'});
      this.closeLeftMenu();
    },

    async onDeleteActiveRoom(this: any) {
      if (!this.activeDialog?.id) return;
      if (this.roomDeletePending) return;
      if (this.activeDialog.kind !== 'direct' && !this.isActiveDialogAdmin) return;

      this.hapticTap();
      const confirmText = this.activeDialog.kind === 'direct'
        ? 'Удалить директ полностью? Это удалит всю переписку у обоих участников.'
        : 'Удалить комнату полностью? Это удалит всю переписку у всех участников.';
      if (!window.confirm(confirmText)) return;

      this.roomDeletePending = true;
      try {
        const roomId = this.activeDialog.id;
        const result = await ws.request('dialogs:delete', roomId, {confirm: true});
        if (!(result as any)?.ok) {
          this.error = this.activeDialog.kind === 'direct'
            ? 'Не удалось удалить директ.'
            : 'Не удалось удалить комнату.';
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
      }
    },

    closeLeftMenu(this: any) {
      this.leftMenuOpen = false;
    },

    onCloseLeftMenuClick(this: any) {
      this.hapticTap();
      this.closeLeftMenu();
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
