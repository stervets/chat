import {ref} from 'vue';

export default {
  async setup() {
    const nickname = ref('');
    const password = ref('');
    const error = ref('');
    const loading = ref(false);
    const config = useRuntimeConfig();
    const router = useRouter();

    const onLogin = async () => {
      error.value = '';
      if (!nickname.value || !password.value) {
        error.value = 'Введите nickname и пароль.';
        return;
      }

      loading.value = true;
      try {
        const response = await fetch(`${config.public.apiUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            nickname: nickname.value,
            password: password.value
          })
        });

        if (!response.ok) {
          error.value = 'Неверный nickname или пароль.';
          return;
        }

        await router.push('/chat');
      } catch (e) {
        error.value = 'Сервер недоступен.';
      } finally {
        loading.value = false;
      }
    };

    return {
      nickname,
      password,
      error,
      loading,
      onLogin
    };
  }
}
