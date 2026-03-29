import {ref, onMounted, nextTick, computed} from 'vue';
import type {Dialog, Message, User} from '@/composables/types';
import {linkify} from '@/composables/utils';
import {getApiBase, getWsUrl} from '@/composables/api';

export default {
  async setup() {
    const router = useRouter();
    const apiBase = getApiBase();
    const wsUrl = getWsUrl();

    const users = ref<User[]>([]);
    const generalDialog = ref<Dialog | null>(null);
    const activeDialog = ref<Dialog | null>(null);
    const messages = ref<Message[]>([]);
    const messageText = ref('');
    const error = ref('');
    const historyLoading = ref(false);
    const messagesEl = ref<HTMLDivElement | null>(null);
    const showUsers = ref(false);
    const searchQuery = ref('');

    const filteredUsers = computed(() => {
      const query = searchQuery.value.trim().toLowerCase();
      if (!query) return users.value;
      return users.value.filter((user) =>
        user.nickname.toLowerCase().includes(query)
      );
    });

    const ws = ref<WebSocket | null>(null);
    const wsReady = ref(false);
    const pendingMessages = ref<{dialogId: number; body: string}[]>([]);

    const ensureAuth = async () => {
      const response = await fetch(`${apiBase}/api/me`, {
        credentials: 'include'
      });

      if (!response.ok) {
        await router.push('/login');
        return false;
      }

      return true;
    };

    const fetchUsers = async () => {
      const response = await fetch(`${apiBase}/api/users`, {
        credentials: 'include'
      });

      if (response.ok) {
        users.value = await response.json();
      }
    };

    const fetchGeneralDialog = async () => {
      const response = await fetch(`${apiBase}/api/dialogs/general`, {
        credentials: 'include'
      });

      if (!response.ok) return null;
      const data = await response.json();
      return {
        id: data.dialogId,
        kind: 'general',
        title: data.title
      } as Dialog;
    };

    const fetchPrivateDialog = async (user: User) => {
      const response = await fetch(`${apiBase}/api/dialogs/private/${user.id}`, {
        method: 'POST',
        credentials: 'include'
      });

      if (!response.ok) {
        error.value = 'Не удалось открыть диалог.';
        return null;
      }

      const data = await response.json();
      return {
        id: data.dialogId,
        kind: 'private',
        targetUser: data.targetUser,
        title: data.targetUser.nickname
      } as Dialog;
    };

    const loadHistory = async (dialogId: number) => {
      historyLoading.value = true;
      try {
        const response = await fetch(
          `${apiBase}/api/dialogs/${dialogId}/messages?limit=100`,
          {credentials: 'include'}
        );

        if (!response.ok) {
          error.value = 'Не удалось загрузить историю.';
          return;
        }

        messages.value = await response.json();
        await nextTick();
        scrollToBottom();
      } finally {
        historyLoading.value = false;
      }
    };

    const connectWs = () => {
      if (ws.value) return;
      if (!wsUrl) return;
      ws.value = new WebSocket(wsUrl);

      ws.value.onopen = () => {
        wsReady.value = true;
        if (activeDialog.value) {
          joinDialog(activeDialog.value.id);
        }
        if (pendingMessages.value.length) {
          const pending = pendingMessages.value.slice();
          pendingMessages.value = [];
          setTimeout(() => {
            for (const msg of pending) {
              sendWs('chat:send', msg);
            }
          }, 50);
        }
      };

      ws.value.onmessage = (event) => {
        let data: any = null;
        try {
          data = JSON.parse(event.data);
        } catch (e) {
          return;
        }

        if (data.type === 'chat:message') {
          if (activeDialog.value && data.payload.dialogId === activeDialog.value.id) {
            messages.value.push(data.payload);
            nextTick().then(scrollToBottom);
          }
        }

        if (data.type === 'chat:error') {
          error.value = data.payload?.message || 'Ошибка чата.';
        }
      };

      ws.value.onclose = () => {
        wsReady.value = false;
        ws.value = null;
      };
    };

    const sendWs = (type: string, payload: any) => {
      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return;
      ws.value.send(JSON.stringify({type, payload}));
    };

    const joinDialog = (dialogId: number) => {
      sendWs('chat:join', {dialogId});
    };

    const selectDialog = async (dialog: Dialog) => {
      activeDialog.value = dialog;
      messages.value = [];
      error.value = '';
      await loadHistory(dialog.id);
      if (wsReady.value) {
        joinDialog(dialog.id);
      }
    };

    const selectGeneral = async () => {
      if (!generalDialog.value) return;
      await selectDialog(generalDialog.value);
    };

    const selectPrivate = async (user: User) => {
      const dialog = await fetchPrivateDialog(user);
      if (!dialog) return;
      await selectDialog(dialog);
    };

    const openUsers = () => {
      showUsers.value = true;
    };

    const closeUsers = () => {
      showUsers.value = false;
    };

    const selectUser = async (user: User) => {
      await selectPrivate(user);
      showUsers.value = false;
    };

    const onSend = () => {
      if (!activeDialog.value) return;
      const text = messageText.value.trim();
      if (!text) return;
      const payload = {dialogId: activeDialog.value.id, body: text};
      if (wsReady.value) {
        sendWs('chat:send', payload);
      } else {
        pendingMessages.value.push(payload);
        connectWs();
      }
      messageText.value = '';
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        onSend();
      }
    };

    const onLogout = async () => {
      error.value = '';
      try {
        await fetch(`${apiBase}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include'
        });
      } catch (e) {
        // ignore
      } finally {
        if (ws.value) {
          ws.value.close();
          ws.value = null;
        }
        await router.push('/login');
      }
    };

    const scrollToBottom = () => {
      if (!messagesEl.value) return;
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    };

    onMounted(async () => {
      const ok = await ensureAuth();
      if (!ok) return;

      generalDialog.value = await fetchGeneralDialog();
      await fetchUsers();

      if (generalDialog.value) {
        await selectDialog(generalDialog.value);
      }

      connectWs();
    });

    return {
      users,
      generalDialog,
      activeDialog,
      messages,
      messageText,
      error,
      historyLoading,
      messagesEl,
      selectGeneral,
      selectPrivate,
      selectUser,
      openUsers,
      closeUsers,
      showUsers,
      searchQuery,
      filteredUsers,
      onSend,
      onKeydown,
      onLogout,
      linkify
    };
  }
}
