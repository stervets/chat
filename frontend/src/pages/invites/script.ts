export default {
  async setup() {
    return {
      router: useRouter(),
    };
  },

  methods: {
    async redirectToConsole(this: any) {
      await this.router.replace({
        path: '/console',
        query: {
          tab: 'invites',
        },
      });
    },
  },

  async mounted(this: any) {
    await this.redirectToConsole();
  },
};
