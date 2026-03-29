import {ref} from 'vue';
import {getApiBase} from '@/composables/api';

export default {
  async setup() {
    const route = useRoute();
    const router = useRouter();
    const apiBase = getApiBase();

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
        const response = await fetch(`${apiBase}/api/invites/redeem`, {
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
          let message = 'Не удалось зарегистрироваться по инвайту.';
          try {
            const data = await response.json();
            const err = data?.error;
            if (err === 'invite_not_found') message = 'Инвайт не найден. Создайте новый.';
            else if (err === 'invite_invalid') message = 'Инвайт уже использован или истек.';
            else if (err === 'nickname_taken') message = 'Никнейм уже занят.';
            else if (err === 'invalid_input') message = 'Заполните все поля.';
          } catch {
            // ignore parse errors
          }
          error.value = message;
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
