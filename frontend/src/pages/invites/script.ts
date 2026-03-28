import {ref, onMounted} from 'vue';
import type {Invite} from '@/composables/types';

export default {
  async setup() {
    const router = useRouter();
    const config = useRuntimeConfig();

    const invites = ref<Invite[]>([]);
    const loading = ref(false);
    const creating = ref(false);
    const error = ref('');

    const ensureAuth = async () => {
      const response = await fetch(`${config.public.apiUrl}/api/me`, {
        credentials: 'include'
      });

      if (!response.ok) {
        await router.push('/login');
        return false;
      }

      return true;
    };

    const fetchInvites = async () => {
      loading.value = true;
      error.value = '';
      try {
        const response = await fetch(`${config.public.apiUrl}/api/invites`, {
          credentials: 'include'
        });

        if (response.status === 401) {
          await router.push('/login');
          return;
        }

        if (!response.ok) {
          error.value = 'Не удалось загрузить инвайты.';
          return;
        }

        invites.value = await response.json();
      } catch (e) {
        error.value = 'Сервер недоступен.';
      } finally {
        loading.value = false;
      }
    };

    const onCreate = async () => {
      if (creating.value) return;
      creating.value = true;
      error.value = '';

      try {
        const response = await fetch(`${config.public.apiUrl}/api/invites/create`, {
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
        invites.value = [
          {
            ...created,
            usedAt: null,
            usedBy: null,
            isUsed: false
          },
          ...invites.value
        ];
      } catch (e) {
        error.value = 'Сервер недоступен.';
      } finally {
        creating.value = false;
      }
    };

    const formatDate = (value: string) => new Date(value).toLocaleString();

    onMounted(async () => {
      const ok = await ensureAuth();
      if (!ok) return;
      await fetchInvites();
    });

    return {
      invites,
      loading,
      creating,
      error,
      onCreate,
      formatDate
    };
  }
}
