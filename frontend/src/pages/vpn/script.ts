import {ref} from 'vue';
import QRCode from 'qrcode';
import {ws} from '@/composables/classes/ws';
import {ensureWsConnected, wsProvisionVpn, wsSetVpnDonation} from '@/composables/ws-rpc';

const DEFAULT_MTPROXY_DEEP_LINK = 'tg://proxy?server=151.245.137.79&port=8443&secret=c6fab0c23452644261db3661aa963f50';
const DEFAULT_MTPROXY_WEB_LINK = 'https://t.me/proxy?server=151.245.137.79&port=8443&secret=c6fab0c23452644261db3661aa963f50';
const DONATION_UNDO_WINDOW_MS = 5 * 60 * 1000;

type VpnProvisionState = 'idle' | 'loading' | 'success' | 'error';

export default {
  async setup() {
    const router = useRouter();
    const runtimeConfig = useRuntimeConfig();
    const vpnConfig = (runtimeConfig.public as any)?.vpn || {};
    const amneziaFiles = vpnConfig.amneziaFiles || {};

    return {
      router,
      mtProxyDeepLink: String(vpnConfig.mtProxyDeepLink || DEFAULT_MTPROXY_DEEP_LINK).trim(),
      mtProxyWebLink: String(vpnConfig.mtProxyWebLink || DEFAULT_MTPROXY_WEB_LINK).trim(),
      amneziaFileWindows: ref(String(amneziaFiles.windows || '').trim()),
      amneziaFileLinux: ref(String(amneziaFiles.linux || '').trim()),
      amneziaFileAndroid: ref(String(amneziaFiles.android || '').trim()),
      amneziaFileMacOs: ref(String(amneziaFiles.macos || 'AmneziaVPN_4.8.11.4_macos.zip').trim()),
      vpnProvisionState: ref<VpnProvisionState>('idle'),
      vpnProvisionError: ref(''),
      vpnProvisionLink: ref(''),
      vpnProvisionQrDataUrl: ref(''),
      vpnProvisionQrError: ref(''),
      copiedVpnLink: ref(false),
      copyVpnError: ref(''),
      copiedDonationPhone: ref(false),
      donationPhone: ref(''),
      donationBank: ref(''),
      vpnInfoLoading: ref(false),
      vpnInfoError: ref(''),
      donationUndoUntilTs: ref(0),
      donationUndoTimer: ref<number | null>(null),
      donationActionError: ref(''),
    };
  },

  computed: {
    downloadHrefWindows(this: any) {
      if (!this.amneziaFileWindows) return '';
      return `/amnezia/${encodeURIComponent(this.amneziaFileWindows)}`;
    },

    downloadHrefLinux(this: any) {
      if (!this.amneziaFileLinux) return '';
      return `/amnezia/${encodeURIComponent(this.amneziaFileLinux)}`;
    },

    downloadHrefAndroid(this: any) {
      if (!this.amneziaFileAndroid) return '';
      return `/amnezia/${encodeURIComponent(this.amneziaFileAndroid)}`;
    },

    downloadHrefMacOs(this: any) {
      if (!this.amneziaFileMacOs) return '';
      return `/amnezia/${encodeURIComponent(this.amneziaFileMacOs)}`;
    },

    donationButtonUndoMode(this: any) {
      return Number(this.donationUndoUntilTs || 0) > Date.now();
    },

    donationButtonText(this: any) {
      return this.donationButtonUndoMode
        ? 'Ой, т.е. не отправил...'
        : 'Я отправил пожертвование!';
    },
  },

  methods: {
    async copyToClipboard(this: any, valueRaw: unknown) {
      const value = String(valueRaw || '').trim();
      if (!value) return false;

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch {}

      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    },

    async copyVpnLink(this: any) {
      this.copyVpnError = '';
      const copied = await this.copyToClipboard(this.vpnProvisionLink);
      if (!copied) {
        this.copyVpnError = 'Не удалось скопировать ссылку.';
        return;
      }

      this.copiedVpnLink = true;
      window.setTimeout(() => {
        this.copiedVpnLink = false;
      }, 2000);
    },

    async copyDonationPhone(this: any) {
      const copied = await this.copyToClipboard(this.donationPhone);
      if (!copied) return;
      this.copiedDonationPhone = true;
      window.setTimeout(() => {
        this.copiedDonationPhone = false;
      }, 2000);
    },

    async requestVpnProvision(this: any) {
      if (this.vpnProvisionState === 'loading') return;

      this.vpnProvisionState = 'loading';
      this.vpnProvisionError = '';
      this.copyVpnError = '';
      this.vpnProvisionQrError = '';
      this.copiedVpnLink = false;

      try {
        const result = await wsProvisionVpn();
        if (!(result as any)?.ok) {
          const errorCode = String((result as any)?.error || '');
          this.vpnProvisionState = 'error';
          this.vpnProvisionError = errorCode === 'unauthorized'
            ? 'Нужна авторизация. Перезайди в аккаунт.'
            : 'Не удалось получить VPN. Попробуй ещё раз.';
          return;
        }

        const link = String((result as any)?.link || '').trim();
        const configText = String((result as any)?.configText || '');
        const qrText = String((result as any)?.qrText || '').trim();
        if (!link || !configText || !qrText) {
          this.vpnProvisionState = 'error';
          this.vpnProvisionError = 'Сервер вернул неполные данные VPN.';
          return;
        }

        this.vpnProvisionLink = link;

        try {
          this.vpnProvisionQrDataUrl = await QRCode.toDataURL(qrText, {
            errorCorrectionLevel: 'M',
            width: 420,
            margin: 1,
          });
        } catch {
          this.vpnProvisionQrDataUrl = '';
          this.vpnProvisionQrError = 'Не удалось отрисовать QR. Используй ссылку или текст конфига.';
        }

        this.vpnProvisionState = 'success';
      } catch {
        this.vpnProvisionState = 'error';
        this.vpnProvisionError = 'Сервер недоступен.';
      }
    },

    onDownloadClick(this: any, hrefRaw: unknown) {
      const href = String(hrefRaw || '').trim();
      if (!href) return;
      window.location.href = href;
    },

    clearDonationUndoTimer(this: any) {
      if (!this.donationUndoTimer) return;
      clearTimeout(this.donationUndoTimer);
      this.donationUndoTimer = null;
    },

    startDonationUndoWindow(this: any) {
      this.clearDonationUndoTimer();
      this.donationUndoUntilTs = Date.now() + DONATION_UNDO_WINDOW_MS;
      this.donationUndoTimer = window.setTimeout(() => {
        this.donationUndoUntilTs = 0;
        this.donationUndoTimer = null;
      }, DONATION_UNDO_WINDOW_MS);
    },

    async onDonationButtonClick(this: any) {
      const shouldSetDonation = !this.donationButtonUndoMode;
      this.donationActionError = '';

      if (shouldSetDonation) {
        this.startDonationUndoWindow();
      } else {
        this.clearDonationUndoTimer();
        this.donationUndoUntilTs = 0;
      }

      const result = await wsSetVpnDonation(shouldSetDonation);
      if ((result as any)?.ok) return;
      this.donationActionError = 'Не удалось отправить статус пожертвования.';
    },

    async onBackToChat(this: any) {
      try {
        await this.router.push('/chat');
      } catch {
        if (typeof window !== 'undefined') {
          window.location.assign('/chat');
        }
      }
    },

    async fetchVpnInfo(this: any) {
      this.vpnInfoLoading = true;
      this.vpnInfoError = '';

      try {
        const connected = await ensureWsConnected();
        if (!(connected as any)?.ok) {
          this.vpnInfoError = 'Не удалось получить реквизиты.';
          return;
        }

        const result = await ws.request('public:vpnInfo');
        if (!(result as any)?.ok) {
          this.vpnInfoError = 'Не удалось получить реквизиты.';
          return;
        }

        this.donationPhone = String((result as any).donationPhone || '').trim();
        this.donationBank = String((result as any).donationBank || '').trim();
      } catch {
        this.vpnInfoError = 'Сервер недоступен.';
      } finally {
        this.vpnInfoLoading = false;
      }
    },
  },

  mounted(this: any) {
    void this.fetchVpnInfo();
  },

  beforeUnmount(this: any) {
    this.clearDonationUndoTimer();
  },
};
