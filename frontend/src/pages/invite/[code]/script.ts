import {ref} from 'vue';
import {wsCheckInvite, wsRedeemInvite} from '@/composables/ws-rpc';

export default {
  async setup() {
    const route = useRoute();
    const codeParam = Array.isArray(route.params.code) ? route.params.code[0] : route.params.code;
    return {
      router: useRouter(),
      code: ref(codeParam || ''),
      nickname: ref(''),
      password: ref(''),
      error: ref(''),
      loading: ref(false),
      inviteChecking: ref(true),
      inviteValid: ref(false),
    };
  },

  methods: {
    mapInviteError(this: any, errRaw: unknown) {
      const err = String(errRaw || '');
      if (err === 'invite_not_found') return 'Инвайт не найден.';
      if (err === 'invite_invalid') return 'Инвайт уже использован или истек.';
      if (err === 'invalid_input') return 'Некорректный код инвайта.';
      if (err === 'ws_connect_error') return 'Не удалось подключиться к серверу.';
      return 'Не удалось проверить инвайт.';
    },

    async validateInvite(this: any) {
      this.inviteChecking = true;
      this.inviteValid = false;
      this.error = '';

      try {
        const result = await wsCheckInvite(this.code);
        if ((result as any)?.ok) {
          this.inviteValid = true;
          return;
        }

        this.inviteValid = false;
        this.error = this.mapInviteError((result as any)?.error);
      } catch {
        this.inviteValid = false;
        this.error = 'Сервер недоступен.';
      } finally {
        this.inviteChecking = false;
      }
    },

    async onRegister(this: any) {
      this.error = '';
      const nickname = String(this.nickname || '').trim().toLowerCase();
      const password = String(this.password || '');
      if (!this.inviteValid) {
        this.error = 'Регистрация по этому инвайту недоступна.';
        return;
      }
      if (!nickname || !password || !this.code) {
        this.error = 'Заполните все поля.';
        return;
      }

      this.loading = true;
      try {
        const result = await wsRedeemInvite(this.code, nickname, password);
        if (!(result as any)?.ok) {
          let message = 'Не удалось зарегистрироваться по инвайту.';
          const err = (result as any)?.error;
          if (err === 'invite_not_found') message = 'Инвайт не найден. Создайте новый.';
          else if (err === 'invite_invalid') message = 'Инвайт уже использован или истек.';
          else if (err === 'nickname_taken') message = 'Никнейм уже занят.';
          else if (err === 'invalid_nickname') message = 'Никнейм: только a-z, 0-9, _ и -, длина 3-32.';
          else if (err === 'invalid_input') message = 'Заполните все поля.';
          this.error = message;
          return;
        }

        await this.router.push('/chat');
      } catch {
        this.error = 'Сервер недоступен.';
      } finally {
        this.loading = false;
      }
    },

    onKeydown(this: any, event: KeyboardEvent) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.onRegister();
    },
  },

  async mounted(this: any) {
    await this.validateInvite();
  },
};
