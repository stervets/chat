import { ref } from 'vue';
import { wsLogin, restoreSession, getSessionToken, wsObject } from '@/composables/ws-rpc';
import {vibrateConfirm, vibrateError} from '@/utils/vibrate';
import {isNativeAndroidApp} from '@/composables/native-runtime';

const RESERVE_CHANNEL_ENABLED_KEY = 'marx_reserve_channel_enabled';
const RESERVE_CHANNEL_NO_PROMPT_KEY = 'marx_reserve_channel_no_prompt';

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
        isMaxAutotestEnabled(this: any) {
            if (!isNativeAndroidApp()) return false;
            try {
                return localStorage.getItem('marx_max_autotest') === '1';
            } catch {
                return false;
            }
        },

        async runMaxAutotest(this: any) {
            if (!isNativeAndroidApp()) return;
            if (!this.isMaxAutotestEnabled()) return;
            const nickname = String(localStorage.getItem('marx_max_autotest_nickname') || '').trim();
            const password = String(localStorage.getItem('marx_max_autotest_password') || '');
            if (!nickname || !password) {
                console.info('[max-autotest] skipped: no credentials');
                return;
            }

            try {
                localStorage.setItem(RESERVE_CHANNEL_ENABLED_KEY, '1');
                localStorage.setItem(RESERVE_CHANNEL_NO_PROMPT_KEY, '0');
            } catch {
                // ignore localStorage errors
            }

            console.info('[max-autotest] start');
            this.nickname = nickname;
            this.password = password;

            const result = await wsLogin(this.nickname, this.password);
            const safeResult = {
                ok: !!result?.ok,
                error: String((result as any)?.error || ''),
                hasData: !!wsObject(result).user?.id,
            };
            console.info(`[max-autotest] login-result ${JSON.stringify(safeResult)}`);
        },

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
        void this.runMaxAutotest();
    },

    beforeUnmount(this: any) {
        if (!this.submitErrorPulseTimer) return;
        clearTimeout(this.submitErrorPulseTimer);
        this.submitErrorPulseTimer = null;
    }
};
