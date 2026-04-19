import { ref } from 'vue';
import { wsLogin, restoreSession, getSessionToken } from '@/composables/ws-rpc';
import {vibrateConfirm, vibrateError} from '@/utils/vibrate';

export default {
    async setup() {
        const router = useRouter();
        return {
            router,
            nickname: ref(''),
            password: ref(''),
            error: ref(''),
            loading: ref(false),
            checkingSession: ref(true),
        };
    },

    methods: {
        async ensureAuth(this: any) {
            const token = String(getSessionToken() || '').trim();
            if (!token) {
                this.checkingSession = false;
                return false;
            }

            try {
                const session = await restoreSession();
                if (!(session as any)?.ok || !(session as any)?.user?.id) {
                    this.checkingSession = false;
                    return false;
                }
                await this.router.replace('/chat');
                return true;
            } catch {
                this.checkingSession = false;
                return false;
            }
        },

        async onLogin(this: any) {
            this.error = '';
            const nickname = String(this.nickname || '').trim().toLowerCase();
            const password = String(this.password || '');
            if (!nickname || !password) {
                this.error = 'Введите nickname и пароль.';
                vibrateError();
                return;
            }

            this.loading = true;
            try {
                const result = await wsLogin(nickname, password);
                if (!(result as any)?.ok) {
                    if ((result as any)?.error === 'invalid_nickname') {
                        this.error = 'Никнейм: только a-z, 0-9, _ и -, длина 3-32.';
                        vibrateError();
                        return;
                    }
                    this.error = 'Неверный nickname или пароль.';
                    vibrateError();
                    return;
                }
                vibrateConfirm();
                await this.router.push('/chat');
            } catch (e) {
                this.error = 'Сервер недоступен.';
                vibrateError();
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
