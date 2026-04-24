export default {
  async setup() {
    return {
      router: useRouter(),
      route: useRoute(),
    };
  },

  methods: {
    async redirectToConsole(this: any) {
      const rawNickname = Array.isArray(this.route?.params?.nickname)
        ? this.route.params.nickname[0]
        : this.route?.params?.nickname;
      const nickname = String(rawNickname || '').trim().toLowerCase();
      await this.router.replace({
        path: '/console',
        query: {
          tab: 'user',
          nickname,
        },
      });
    },
  },

  async mounted(this: any) {
    await this.redirectToConsole();
  },
};
