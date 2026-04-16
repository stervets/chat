import {ws} from '@/composables/classes/ws';
import {restoreSession} from '@/composables/ws-rpc';

export default {
  async setup() {
    return {
      router: useRouter(),
    };
  },

  methods: {
    async redirect(this: any) {
      try {
        const session = await restoreSession();
        if ((session as any)?.ok) {
          const me = await ws.request('auth:me');
          if ((me as any)?.id) {
            await this.router.replace('/chat');
            return;
          }
        }
      } catch {
        // fall through to login
      }

      await this.router.replace('/login');
    }
  },

  mounted(this: any) {
    void this.redirect();
  },
};
