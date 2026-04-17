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
            if (!this.nickname || !this.password) {
                this.error = 'Введите nickname и пароль.';
                return;
            }

            this.loading = true;
            try {
                const result = await wsLogin(this.nickname, this.password);
                if (!(result as any)?.ok) {
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
