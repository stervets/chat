import {onMounted} from 'vue';
import {getApiBase} from '@/composables/api';

export default {
  async setup() {
    const router = useRouter();
    const apiBase = getApiBase();

    const redirect = async () => {
      try {
        const response = await fetch(`${apiBase}/api/me`, {
          credentials: 'include'
        });

        if (response.ok) {
          await router.replace('/chat');
          return;
        }
      } catch (e) {
        // fall through to login
      }

      await router.replace('/login');
    };

    onMounted(() => {
      redirect();
    });

    return {};
  }
}
