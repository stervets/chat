import {ref, onMounted} from 'vue';
import {getApiBase} from '@/composables/api';

export default {
  async setup() {
    const router = useRouter();
    const apiBase = getApiBase();
    const config = useRuntimeConfig();

    const creating = ref(false);
    const error = ref('');
    const lastLink = ref('');
    const copied = ref(false);

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

    const copyToClipboard = async (text: string) => {
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
    };

    const onCreate = async () => {
      if (creating.value) return;
      creating.value = true;
      error.value = '';
      copied.value = false;

      try {
        const response = await fetch(`${apiBase}/api/invites/create`, {
          method: 'POST',
          credentials: 'include'
        });

        if (response.status === 401) {
          await router.push('/login');
          return;
        }

        if (!response.ok) {
          error.value = 'Не удалось создать инвайт.';
          return;
        }

        const created = await response.json();
        const rawPublicUrl = (config.public as any)?.publicUrl || '';
        const publicUrl = rawPublicUrl.trim();
        const origin = publicUrl || window.location.origin;
        const link = `${origin}/invite/${created.code}`;
        lastLink.value = link;
        await copyToClipboard(link);
        copied.value = true;
      } catch (e) {
        error.value = 'Сервер недоступен.';
      } finally {
        creating.value = false;
      }
    };

    onMounted(async () => {
      const ok = await ensureAuth();
      if (!ok) return;
    });

    return {
      creating,
      error,
      onCreate,
      lastLink,
      copied
    };
  }
}
