import {ref} from 'vue';
import {ws} from '@/composables/classes/ws';
import {ensureWsConnected, wsSetVpnDonation} from '@/composables/ws-rpc';

const DEFAULT_MTPROXY_DEEP_LINK = 'tg://proxy?server=151.245.137.79&port=8443&secret=c6fab0c23452644261db3661aa963f50';
const DEFAULT_MTPROXY_WEB_LINK = 'https://t.me/proxy?server=151.245.137.79&port=8443&secret=c6fab0c23452644261db3661aa963f50';
const DEFAULT_AMNEZIA_CONFIG_URI = 'vpn://AAAOAHja7VddU9s6EH3nV2QyfYMGyfqwzVzuDITOJQmFtBlKW9LJOLaSGBLZ2E4gZfjvdyU5idOIB3huPsbSOUfalby7lp_3avCph4ksgliKLK8f1W41pj7P65ZWBY9joLdBTZxjwOsOdnyCOcHso4MJcR0X_vUDi9wxcuIzxjzGQU4R8z1OmVVOjJy6hFLMkJK7lHHm-lY5Xcmpy13fN3IPOT6yyVva93-GNfSEPEo97CH4YPgTtPq4LuU-J3wINsELxF0X-pS7qo98wH0u-MhFfMR9F3TIgdUztJoJhwjBD7Gyryb3oen9MdOuHZ9jmJlC3wuRw0I97s95nCFW4z1X6RzQYx460fZc0K9a4qDh2leP4207iEBLacBlFq1WYKyphSDK3FEwEg7717qf-uZaGfIqQ19l2GtMO1QMtVKz4EmRDNnZWCoWW9meDgdMuZXUa8OeldOrY8TK6fVZo3Ua5MUA0m8Uq9yqP_elgvuQUn3o9-1J1a8frHXOSmfJpqqOrHSWNKrq6Ea3kz8VXav072_ivCdxqhtZ3sAqRHYhuguxHagdGohWMUgGgzK0BcfSwLgK98rbCglQRUsfsVcFSy8ZqYKln9WQCqbT5FFEgzjNFXlrcMOhhv4ebnww-NGRggzyaz1TOI2FLFqRsXG1xHGSXvIfRM6j_dP2uX8WfmsVD9lZKCa9RXd-ndw12xdXskmPK-6YScCb1fIbXgM36K4izeLF4F4sjW5-457fPX6P-OkTQzdNsXB_ov2TzyOOlzftw0_jQ3khO_sPndPp2GItnQ83U73XcV0lzBS3LVmIbBSE4le_L0-iKBN5XjuurVZzSBzAzy57gH3ofm19Pvn6YwDdg9qH3qfm1eVZ2QdRF5YZFKIjlqB90yr7sh3CGKoaEE7avG4HT9Bmqt3DCoVggqajmp5qEUUT1aLQ8qFxrnT2Wgeko0lbgQOSaNJW1YCkJblbyvqypWz-rV_vql-we-qmqCspr7S8MnOF321XiEzFZ3c-nMahibDvj24SOrTdabZP8JDyLw_0y_L-v4J0wt835LHTHnXHN9n19bcYHevoFPkkyERUjp6mE2_Jac-_O20tzsf7cTGez5qXdNpl9_5kOBEPd-FPJ-IXVI0-MaWn1VW5sa41BzVdXvryk4zSJJYFkJw3MIPEQQ2MyRFxIRSVdTgRx3kBGdwRIg2m8UKogFJxV0nMSZIXl8FMmNTcmqmimhXzsuIQt1pc07UNqBAiHWgr5UO4-gRPk6xQsPZtg-b3m8Lypt3ZzJyLbCGy7Rr1ptsEhfqlL23HG-W0Otdop62CLCmSMJkOFmobEn0ys7405POhFMUgMKXOHOB0rbMe44oskLkyPtAGlHwepfUt4cv2uM1LkFIHMyl-x8FHeOdxNsNe9swDybw1RWIUzKdF89Vxa10eZnFalMtT4QL73MjmtXwGD8ea2f-1WubmDNrQ3wpsTp86itfwKvYUtRV5K4EE8gqmz-IoEvJ0eZ1rR4tsLvZe9v4HFs1YTg';
const DONATION_UNDO_WINDOW_MS = 5 * 60 * 1000;

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
      amneziaConfigUri: String(vpnConfig.amneziaConfigUri || DEFAULT_AMNEZIA_CONFIG_URI).trim(),
      amneziaFileWindows: ref(String(amneziaFiles.windows || '').trim()),
      amneziaFileLinux: ref(String(amneziaFiles.linux || '').trim()),
      amneziaFileAndroid: ref(String(amneziaFiles.android || '').trim()),
      copiedConfigUri: ref(false),
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

    donationButtonUndoMode(this: any) {
      return Number(this.donationUndoUntilTs || 0) > Date.now();
    },

    donationButtonText(this: any) {
      return this.donationButtonUndoMode
        ? 'Ой, т.е. не отправлено!'
        : 'Пожертвование отправлено!';
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

    async copyAmneziaConfigUri(this: any) {
      const copied = await this.copyToClipboard(this.amneziaConfigUri);
      if (!copied) return;
      this.copiedConfigUri = true;
      window.setTimeout(() => {
        this.copiedConfigUri = false;
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
