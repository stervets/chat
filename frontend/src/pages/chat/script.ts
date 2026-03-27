import {ref, onMounted, nextTick} from 'vue';
import type {Dialog, Message, User} from '@/composables/types';
import {linkify} from '@/composables/utils';

export default {
  async setup() {
    const router = useRouter();
    const config = useRuntimeConfig();

    const me = ref<User | null>(null);
    const users = ref<User[]>([]);
    const generalDialog = ref<Dialog | null>(null);
    const activeDialog = ref<Dialog | null>(null);
    const messages = ref<Message[]>([]);
    const messageText = ref('');
    const error = ref('');
    const historyLoading = ref(false);
    const messagesEl = ref<HTMLDivElement | null>(null);

    const ws = ref<WebSocket | null>(null);
    const wsReady = ref(false);

    const fetchMe = async () => {
      const response = await fetch(`${config.public.apiUrl}/api/me`, {
        credentials: 'include'
      });

      if (!response.ok) {
        await router.push('/login');
        return null;
      }

      return await response.json();
    };

    const fetchUsers = async () => {
      const response = await fetch(`${config.public.apiUrl}/api/users`, {
        credentials: 'include'
      });

      if (response.ok) {
        users.value = await response.json();
      }
    };

    const fetchGeneralDialog = async () => {
      const response = await fetch(`${config.public.apiUrl}/api/dialogs/general`, {
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
      const response = await fetch(`${config.public.apiUrl}/api/dialogs/private/${user.id}`, {
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
          `${config.public.apiUrl}/api/dialogs/${dialogId}/messages?limit=100`,
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
      ws.value = new WebSocket(config.public.wsUrl);

      ws.value.onopen = () => {
        wsReady.value = true;
        if (activeDialog.value) {
          joinDialog(activeDialog.value.id);
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

    const onSend = () => {
      if (!activeDialog.value) return;
      const text = messageText.value.trim();
      if (!text) return;
      sendWs('chat:send', {
        dialogId: activeDialog.value.id,
        body: text
      });
      messageText.value = '';
    };

    const scrollToBottom = () => {
      if (!messagesEl.value) return;
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    };

    onMounted(async () => {
      me.value = await fetchMe();
      if (!me.value) return;

      generalDialog.value = await fetchGeneralDialog();
      await fetchUsers();

      if (generalDialog.value) {
        await selectDialog(generalDialog.value);
      }

      connectWs();
    });

    return {
      me,
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
      onSend,
      linkify
    };
  }
}
