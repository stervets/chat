import {onMounted} from 'vue';

export default {
  async setup() {
    const router = useRouter();
    const config = useRuntimeConfig();

    const redirect = async () => {
      try {
        const response = await fetch(`${config.public.apiUrl}/api/me`, {
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
