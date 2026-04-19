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
      this.hapticTap();
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
