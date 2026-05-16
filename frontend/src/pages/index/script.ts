import {getSessionToken, restoreSession, wsObject} from '@/composables/ws-rpc';

export default {
  async setup() {
    return {
      router: useRouter(),
    };
  },

  methods: {
    async redirect(this: any) {
      const token = String(getSessionToken() || '').trim();
      if (!token) {
        await this.router.replace('/login');
        return;
      }

      try {
        const session = await restoreSession();
        if ((session as any)?.ok && wsObject(session).user?.id) {
          await this.router.replace('/chat');
          return;
        }

        if ((session as any)?.error === 'unauthorized') {
          await this.router.replace('/login');
          return;
        }
      } catch {
        // сеть может быть мертва при старте, не держим splash вечно
      }

      await this.router.replace('/chat');
    }
  },

  mounted(this: any) {
    void this.redirect();
  },
};
