import { computed } from 'vue';
import {loadLastChatPath} from '@/composables/last-chat';

export default {
  setup() {
    const error = useError();

    const statusCode = computed(() => {
      const rawStatus = Number((error.value as any)?.statusCode || 500);
      return Number.isFinite(rawStatus) ? rawStatus : 500;
    });

    const titleText = computed(() => {
      if (statusCode.value === 404) return 'Страница не найдена';
      return 'Ошибка приложения';
    });

    const descriptionText = computed(() => {
      if (statusCode.value === 404) {
        return 'Такой страницы в MARX нет. Либо ссылка битая, либо маршрут уже выпилен.';
      }

      const statusMessage = String((error.value as any)?.statusMessage || '').trim();
      if (statusMessage) return statusMessage;
      return 'Что-то сломалось на клиенте. Обнови страницу или зайди в чат заново.';
    });

    return {
      statusCode,
      titleText,
      descriptionText
    };
  },

  methods: {
    onGoHome(this: any) {
      clearError({ redirect: loadLastChatPath() });
    },

    onRetry(this: any) {
      clearError();
      window.location.reload();
    }
  }
};
