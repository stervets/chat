import {usePwaInstall} from '@/composables/use-pwa-install';

export default {
  setup() {
    return {
      ...usePwaInstall(),
    };
  },

  computed: {
    shouldRender(this: any) {
      if (this.isInstalled) return false;
      return this.isInstallAvailable || this.isIos;
    },

    showInstallButton(this: any) {
      return !this.isInstalled && this.isInstallAvailable;
    },

    showIosHelperButton(this: any) {
      return !this.isInstalled && !this.isInstallAvailable && this.isIos && this.isSafari;
    },

    showIosNonSafariHint(this: any) {
      return !this.isInstalled && !this.isInstallAvailable && this.isIos && !this.isSafari;
    },
  },

  methods: {
    async onInstall(this: any) {
      await this.installApp();
    },

    toggleIosInstructions(this: any) {
      this.showIosInstructions = !this.showIosInstructions;
    },
  },
};
