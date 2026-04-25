import PwaInstallCard from '@/components/pwa-install-card/index.vue';
import {ShieldCheck} from 'lucide-vue-next';

export default {
  components: {
    PwaInstallCard,
    ShieldCheck,
  },

  props: {
    amneziaFileAndroid: {type: String, default: ''},
    amneziaFileLinux: {type: String, default: ''},
    amneziaFileMacOs: {type: String, default: ''},
    amneziaFileWindows: {type: String, default: ''},
    copiedVpnLink: Boolean,
    copyVpnError: {type: String, default: ''},
    downloadHrefAndroid: {type: String, default: ''},
    downloadHrefLinux: {type: String, default: ''},
    downloadHrefMacOs: {type: String, default: ''},
    downloadHrefWindows: {type: String, default: ''},
    mtProxyDeepLink: {type: String, default: ''},
    mtProxyWebLink: {type: String, default: ''},
    vpnProvisionError: {type: String, default: ''},
    vpnProvisionLink: {type: String, default: ''},
    vpnProvisionQrDataUrl: {type: String, default: ''},
    vpnProvisionQrError: {type: String, default: ''},
    vpnProvisionState: {type: String, default: 'idle'},
  },

  emits: [
    'copy-vpn-link',
    'download-click',
    'request-vpn-provision',
  ],

  methods: {
    onDownloadClick(this: any, href: string) {
      this.$emit('download-click', href);
    },

    requestVpnProvision(this: any) {
      this.$emit('request-vpn-provision');
    },

    copyVpnLink(this: any) {
      this.$emit('copy-vpn-link');
    },
  },
};
