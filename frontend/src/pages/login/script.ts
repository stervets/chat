import { ref } from 'vue';
import { wsLogin, restoreSession, getSessionToken, wsObject } from '@/composables/ws-rpc';
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
            submitErrorPulse: ref(false),
            submitErrorPulseTimer: ref<number | null>(null),
        };
    },

    methods: {
        triggerSubmitErrorPulse(this: any) {
            if (typeof window === 'undefined') return;
            this.submitErrorPulse = false;
            if (this.submitErrorPulseTimer) {
                clearTimeout(this.submitErrorPulseTimer);
                this.submitErrorPulseTimer = null;
            }
            window.requestAnimationFrame(() => {
                this.submitErrorPulse = true;
                this.submitErrorPulseTimer = window.setTimeout(() => {
                    this.submitErrorPulse = false;
                    this.submitErrorPulseTimer = null;
                }, 220);
            });
        },

        async ensureAuth(this: any) {
            const token = String(getSessionToken() || '').trim();
            if (!token) {
                this.checkingSession = false;
                return false;
            }

            try {
                const session = await restoreSession();
                if (!(session as any)?.ok || !wsObject(session).user?.id) {
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
                this.triggerSubmitErrorPulse();
                vibrateError();
                return;
            }

            this.loading = true;
            try {
                const result = await wsLogin(nickname, password);
                if (!(result as any)?.ok) {
                    if ((result as any)?.error === 'invalid_nickname') {
                        this.error = 'Никнейм: только a-z, 0-9, _ и -, длина 3-32.';
                        this.triggerSubmitErrorPulse();
                        vibrateError();
                        return;
                    }
                    this.error = 'Неверный nickname или пароль.';
                    this.triggerSubmitErrorPulse();
                    vibrateError();
                    return;
                }
                vibrateConfirm();
                await this.router.push('/chat');
            } catch (e) {
                this.error = 'Сервер недоступен.';
                this.triggerSubmitErrorPulse();
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
    },

    beforeUnmount(this: any) {
        if (!this.submitErrorPulseTimer) return;
        clearTimeout(this.submitErrorPulseTimer);
        this.submitErrorPulseTimer = null;
    }
};
