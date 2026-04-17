import { ref } from 'vue';
import { wsLogin } from '@/composables/ws-rpc';

const SOUND_OVERLAY_SKIP_ONCE_KEY = 'chat:sound-overlay-skip-once:v1';

export default {
    async setup() {
        const router = useRouter();
        return {
            router,
            nickname: ref(''),
            password: ref(''),
            error: ref(''),
            loading: ref(false)
        };
    },

    methods: {
        async onLogin(this: any) {
            this.error = '';
            const nickname = String(this.nickname || '').trim().toLowerCase();
            const password = String(this.password || '');
            if (!nickname || !password) {
                this.error = 'Введите nickname и пароль.';
                return;
            }

            this.loading = true;
            try {
                const result = await wsLogin(nickname, password);
                if (!(result as any)?.ok) {
                    if ((result as any)?.error === 'invalid_nickname') {
                        this.error = 'Никнейм: только a-z, 0-9, _ и -, длина 3-32.';
                        return;
                    }
                    this.error = 'Неверный nickname или пароль.';
                    return;
                }

                if (typeof window !== 'undefined') {
                    window.sessionStorage.setItem(SOUND_OVERLAY_SKIP_ONCE_KEY, '1');
                }
                await this.router.push('/chat');
            } catch (e) {
                this.error = 'Сервер недоступен.';
            } finally {
                this.loading = false;
            }
        },

        onKeydown(this: any, event: KeyboardEvent) {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void this.onLogin();
        }
    }
};
