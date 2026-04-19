import { ref } from 'vue';
import { wsLogin, restoreSession } from '@/composables/ws-rpc';

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
        async ensureAuth(this: any) {
            const session = await restoreSession();
            if (!(session as any)?.ok || !(session as any)?.user?.id) {
                return false;
            }
            await this.router.replace('/chat');
            return true;
        },

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
    },

    mounted(this: any) {
        void this.ensureAuth();
    }
};
