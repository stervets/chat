import {ref, nextTick} from 'vue';
import type {Dialog, Message, User} from '@/composables/types';
import {linkify} from '@/composables/utils';
import {ws} from '@/composables/classes/ws';
import {on, off} from '@/composables/event-bus';
import {restoreSession, wsLogout} from '@/composables/ws-rpc';

export default {
  async setup() {
    return {
      router: useRouter(),

      users: ref<User[]>([]),
      generalDialog: ref<Dialog | null>(null),
      activeDialog: ref<Dialog | null>(null),
      messages: ref<Message[]>([]),
      messageText: ref(''),
      error: ref(''),
      historyLoading: ref(false),
      messagesEl: ref<HTMLDivElement | null>(null),
      showUsers: ref(false),
      searchQuery: ref(''),

      chatMessageHandler: ref<Function | null>(null),
      disconnectedHandler: ref<Function | null>(null),

      linkify,
    };
  },

  computed: {
    filteredUsers(this: any) {
      const query = this.searchQuery.trim().toLowerCase();
      if (!query) return this.users;
      return this.users.filter((user: User) => user.nickname.toLowerCase().includes(query));
    }
  },

  methods: {
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

      return true;
    },

    async fetchUsers(this: any) {
      const result = await ws.request('users:list');
      if (Array.isArray(result)) {
        this.users = result;
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
        title: (result as any).targetUser.nickname,
      } as Dialog;
    },

    async loadHistory(this: any, dialogId: number) {
      this.historyLoading = true;
      try {
        const result = await ws.request('dialogs:messages', dialogId, 100);
        if (!Array.isArray(result)) {
          this.error = 'Не удалось загрузить историю.';
          return;
        }
        this.messages = result;
        await nextTick();
        this.scrollToBottom();
      } finally {
        this.historyLoading = false;
      }
    },

    async joinDialog(this: any, dialogId: number) {
      const result = await ws.request('chat:join', dialogId);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось подключиться к диалогу.';
      }
    },

    async selectDialog(this: any, dialog: Dialog) {
      this.activeDialog = dialog;
      this.messages = [];
      this.error = '';
      await this.loadHistory(dialog.id);
      await this.joinDialog(dialog.id);
    },

    async selectGeneral(this: any) {
      if (!this.generalDialog) return;
      await this.selectDialog(this.generalDialog);
    },

    async selectPrivate(this: any, user: User) {
      const dialog = await this.fetchPrivateDialog(user);
      if (!dialog) return;
      await this.selectDialog(dialog);
    },

    openUsers(this: any) {
      this.showUsers = true;
    },

    closeUsers(this: any) {
      this.showUsers = false;
    },

    async selectUser(this: any, user: User) {
      await this.selectPrivate(user);
      this.showUsers = false;
    },

    async onSend(this: any) {
      if (!this.activeDialog) return;
      const text = this.messageText.trim();
      if (!text) return;
      const result = await ws.request('chat:send', this.activeDialog.id, text);
      if ((result as any)?.ok) {
        this.messageText = '';
      } else {
        this.error = 'Не удалось отправить сообщение.';
      }
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

    scrollToBottom(this: any) {
      if (!this.messagesEl) return;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    },

    onChatMessage(this: any, message: Message) {
      if (!this.activeDialog) return;
      if (message.dialogId !== this.activeDialog.id) return;
      this.messages.push(message);
      nextTick().then(() => this.scrollToBottom());
    },

    onDisconnected(this: any) {
      this.error = 'Соединение потеряно. Перезайди в чат.';
    }
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;

    this.chatMessageHandler = (message: Message) => this.onChatMessage(message);
    this.disconnectedHandler = () => this.onDisconnected();

    on('chat:message', this.chatMessageHandler);
    on('ws:disconnected', this.disconnectedHandler);

    this.generalDialog = await this.fetchGeneralDialog();
    await this.fetchUsers();

    if (this.generalDialog) {
      await this.selectDialog(this.generalDialog);
    }
  },

  beforeUnmount(this: any) {
    this.chatMessageHandler && off('chat:message', this.chatMessageHandler);
    this.disconnectedHandler && off('ws:disconnected', this.disconnectedHandler);
  },
};
