import {ref} from 'vue';

export default {
  async setup() {
    const route = useRoute();
    const router = useRouter();
    const config = useRuntimeConfig();

    const codeParam = Array.isArray(route.params.code) ? route.params.code[0] : route.params.code;
    const code = ref(codeParam || '');
    const nickname = ref('');
    const password = ref('');
    const error = ref('');
    const loading = ref(false);

    const onRegister = async () => {
      error.value = '';
      if (!nickname.value || !password.value || !code.value) {
        error.value = 'Заполните все поля.';
        return;
      }

      loading.value = true;
      try {
        const response = await fetch(`${config.public.apiUrl}/api/invites/redeem`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            code: code.value,
            nickname: nickname.value,
            password: password.value
          })
        });

        if (!response.ok) {
          error.value = 'Не удалось зарегистрироваться по инвайту.';
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
      code,
      nickname,
      password,
      error,
      loading,
      onRegister
    };
  }
}
