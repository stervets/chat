import {ref} from 'vue';
import {restoreSession, wsGamesSoloCreate} from '@/composables/ws-rpc';

export default {
  async setup() {
    return {
      router: useRouter(),
      createPending: ref(false),
      error: ref(''),
    };
  },

  methods: {
    async ensureAuth(this: any) {
      const session = await restoreSession();
      if ((session as any)?.ok && (session as any)?.user?.id) {
        return true;
      }
      await this.router.replace('/login');
      return false;
    },

    async goBackToChat(this: any) {
      await this.router.push('/chat');
    },

    async createSoloKing(this: any) {
      if (this.createPending) return;

      this.createPending = true;
      this.error = '';

      try {
        const result = await wsGamesSoloCreate('king');
        if (!(result as any)?.ok) {
          const code = String((result as any)?.error || 'unknown_error');
          if (code === 'not_enough_bots') {
            this.error = 'На сервере не хватает ботов. Запусти backend: `yarn bots:seed`.';
          } else {
            this.error = `Не удалось создать матч (${code}).`;
          }
          return;
        }

        const sessionId = Number((result as any)?.sessionId || 0);
        if (!Number.isFinite(sessionId) || sessionId <= 0) {
          this.error = 'Сервер вернул некорректный sessionId.';
          return;
        }

        await this.router.push(`/games/session/${sessionId}`);
      } catch {
        this.error = 'Ошибка сети: матч не создан.';
      } finally {
        this.createPending = false;
      }
    },
  },

  async mounted(this: any) {
    await this.ensureAuth();
  },
};
