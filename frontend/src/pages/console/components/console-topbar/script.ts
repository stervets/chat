import {ref} from 'vue';
import {ArrowLeft, Download} from 'lucide-vue-next';
import {usePwaInstall} from '@/composables/use-pwa-install';

export default {
  components: {
    ArrowLeft,
    Download,
  },

  setup() {
    const {isInstalled, installApp, isTelegramInApp} = usePwaInstall();
    return {
      isInstalled,
      installApp,
      isTelegramInApp,
      installBusy: ref(false),
    };
  },

  emits: [
    'back',
  ],

  methods: {
    goBack(this: any) {
      this.$emit('back');
    },

    async onInstallClick(this: any) {
      if (this.installBusy) return;
      this.installBusy = true;
      try {
        await this.installApp();
      } finally {
        this.installBusy = false;
      }
    },
  },
};
