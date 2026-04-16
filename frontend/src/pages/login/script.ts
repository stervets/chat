import { ref } from 'vue';
import { wsLogin } from '@/composables/ws-rpc';

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
