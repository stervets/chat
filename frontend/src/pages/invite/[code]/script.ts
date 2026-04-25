import {ref} from 'vue';
import {restoreSession, wsCheckInvite, wsObject, wsRedeemInvite} from '@/composables/ws-rpc';
import {vibrateConfirm, vibrateError} from '@/utils/vibrate';

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
      existingUserApplied: ref(false),
      existingUserMessage: ref(''),
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

    buildExistingUserInviteMessage(this: any, resultRaw: any) {
      const roomsAdded = Number(resultRaw?.roomsAdded || (Array.isArray(resultRaw?.addedRoomIds) ? resultRaw.addedRoomIds.length : 0));
      if (Number.isFinite(roomsAdded) && roomsAdded > 0) {
        return roomsAdded === 1
          ? 'Получен доступ к 1 новой комнате.'
          : `Получен доступ к ${roomsAdded} новым комнатам.`;
      }
      return 'Инвайт обработан. Новых комнат не добавилось.';
    },

    async tryRedeemForAuthorizedUser(this: any) {
      const session = await restoreSession();
      if (!(session as any)?.ok || !wsObject(session).user?.id) return;
      if (!this.inviteValid) return;

      this.loading = true;
      try {
        const result = await wsRedeemInvite(this.code, '', '');
        if (!(result as any)?.ok) {
          this.error = this.mapInviteError((result as any)?.error);
          return;
        }
        const data = wsObject(result);
        if (data.appliedToExistingUser) {
          this.existingUserApplied = true;
          this.existingUserMessage = this.buildExistingUserInviteMessage(data);
          vibrateConfirm();
        }
      } catch {
        this.error = 'Сервер недоступен.';
      } finally {
        this.loading = false;
      }
    },

    async onRegister(this: any) {
      this.error = '';
      const nickname = String(this.nickname || '').trim().toLowerCase();
      const password = String(this.password || '');
      if (!this.inviteValid) {
        this.error = 'Регистрация по этому инвайту недоступна.';
        vibrateError();
        return;
      }
      if (!nickname || !password || !this.code) {
        this.error = 'Заполните все поля.';
        vibrateError();
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
          vibrateError();
          return;
        }

        vibrateConfirm();
        await this.router.push('/chat');
      } catch {
        this.error = 'Сервер недоступен.';
        vibrateError();
      } finally {
        this.loading = false;
      }
    },

    onKeydown(this: any, event: KeyboardEvent) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.onRegister();
    },

    async onGoChat(this: any) {
      await this.router.push('/chat');
    },
  },

  async mounted(this: any) {
    await this.validateInvite();
    await this.tryRedeemForAuthorizedUser();
  },
};
