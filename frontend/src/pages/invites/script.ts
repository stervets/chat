import {ref} from 'vue';
import {ws} from '@/composables/classes/ws';
import {restoreSession} from '@/composables/ws-rpc';
import {vibrateConfirm, vibrateError} from '@/utils/vibrate';

export default {
  async setup() {
    return {
      router: useRouter(),
      config: useRuntimeConfig(),
      creating: ref(false),
      error: ref(''),
      lastLink: ref(''),
      copied: ref(false),
    };
  },

  methods: {
    async ensureAuth(this: any) {
      const session = await restoreSession();
      if (!(session as any)?.ok) {
        await this.router.push('/login');
        return false;
      }

      return true;
    },

    async copyToClipboard(this: any, text: string) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', 'true');
      input.style.position = 'absolute';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    },

    async onCreate(this: any) {
      if (this.creating) return;
      this.creating = true;
      this.error = '';
      this.copied = false;

      try {
        const created = await ws.request('invites:create');
        if ((created as any)?.error === 'unauthorized' || (created as any)?.ok === false) {
          vibrateError();
          await this.router.push('/login');
          return;
        }
        const rawPublicUrl = (this.config.public as any)?.publicUrl || '';
        const publicUrl = rawPublicUrl.trim();
        const origin = publicUrl || window.location.origin;
        const link = `${origin}/invite/${(created as any).code}`;
        this.lastLink = link;
        await this.copyToClipboard(link);
        this.copied = true;
        vibrateConfirm();
      } catch {
        this.error = 'Сервер недоступен.';
        vibrateError();
      } finally {
        this.creating = false;
      }
    },
  },

  mounted(this: any) {
    void this.ensureAuth();
  },
};
