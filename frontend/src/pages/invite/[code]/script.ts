import {ref} from 'vue';
import {restoreSession, wsCheckInvite, wsObject, wsRedeemInvite} from '@/composables/ws-rpc';
import {vibrateConfirm, vibrateError} from '@/utils/vibrate';
import {usePwaInstall} from '@/composables/use-pwa-install';

export default {
  async setup() {
    const route = useRoute();
    const codeParam = Array.isArray(route.params.code) ? route.params.code[0] : route.params.code;
    const querySource = String(
      (Array.isArray(route.query?.src) ? route.query.src[0] : route.query?.src)
      || (Array.isArray(route.query?.from) ? route.query.from[0] : route.query?.from)
      || ''
    ).trim().toLowerCase();
    const forcedTelegramMode = querySource === 'tg'
      || querySource === 'telegram'
      || querySource === '1';
    const {isTelegramInApp} = usePwaInstall();
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
      isTelegramInApp,
      forceTelegramMode: ref(forcedTelegramMode),
      telegramExternalOpenAttempted: ref(false),
    };
  },

  computed: {
    openInBrowserUrl(this: any) {
      const code = encodeURIComponent(String(this.code || '').trim());
      return `https://marx.core5.ru/invite/${code}`;
    },

    isTelegramMode(this: any) {
      return !!this.isTelegramInApp || !!this.forceTelegramMode;
    },
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

    markTelegramOpenAttempt(this: any) {
      if (typeof window === 'undefined') return;
      const code = String(this.code || '').trim();
      if (!code) return;
      window.sessionStorage.setItem(`invite:telegram-open-attempt:${code}`, '1');
    },

    hasTelegramOpenAttempt(this: any) {
      if (typeof window === 'undefined') return false;
      const code = String(this.code || '').trim();
      if (!code) return false;
      return window.sessionStorage.getItem(`invite:telegram-open-attempt:${code}`) === '1';
    },

    tryOpenInBrowserFromTelegram(this: any) {
      if (typeof window === 'undefined') return;
      if (!this.isTelegramMode) return;
      if (this.telegramExternalOpenAttempted) return;

      const targetUrl = String(this.openInBrowserUrl || '').trim();
      if (!targetUrl) return;

      this.telegramExternalOpenAttempted = true;
      if (this.hasTelegramOpenAttempt()) return;
      this.markTelegramOpenAttempt();

      const tgWebApp = (window as any)?.Telegram?.WebApp;
      try {
        tgWebApp?.openLink?.(targetUrl, {try_browser: 'chrome'});
      } catch {
        // no-op
      }

      const userAgent = String(window.navigator?.userAgent || '').toLowerCase();
      const isAndroid = userAgent.includes('android');
      if (isAndroid) {
        const code = encodeURIComponent(String(this.code || '').trim());
        const intentUrl = `intent://marx.core5.ru/invite/${code}#Intent;scheme=https;package=com.android.chrome;end`;
        window.setTimeout(() => {
          window.location.href = intentUrl;
        }, 120);
      }

      window.setTimeout(() => {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }, 220);
    },

    onOpenInBrowserClick(this: any) {
      this.tryOpenInBrowserFromTelegram();
    },
  },

  async mounted(this: any) {
    if (typeof window !== 'undefined') {
      const referrer = String(document.referrer || '').toLowerCase();
      if (referrer.includes('t.me') || referrer.includes('telegram')) {
        this.forceTelegramMode = true;
      }
    }
    this.tryOpenInBrowserFromTelegram();
    await this.validateInvite();
    await this.tryRedeemForAuthorizedUser();
  },
};
