import {ref} from 'vue';
import {wsRedeemInvite} from '@/composables/ws-rpc';

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
    };
  },

  methods: {
    async onRegister(this: any) {
      this.error = '';
      if (!this.nickname || !this.password || !this.code) {
        this.error = 'Заполните все поля.';
        return;
      }

      this.loading = true;
      try {
        const result = await wsRedeemInvite(this.code, this.nickname, this.password);
        if (!(result as any)?.ok) {
          let message = 'Не удалось зарегистрироваться по инвайту.';
          const err = (result as any)?.error;
          if (err === 'invite_not_found') message = 'Инвайт не найден. Создайте новый.';
          else if (err === 'invite_invalid') message = 'Инвайт уже использован или истек.';
          else if (err === 'nickname_taken') message = 'Никнейм уже занят.';
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
    }
  },
};
