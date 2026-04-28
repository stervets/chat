import {ref} from 'vue';
import QRCode from 'qrcode';
import {getApiBase} from '@/composables/api';
import AvatarCropModal from './components/avatar-crop-modal/index.vue';
import ConsoleMediaViewer from './components/media-viewer/index.vue';
import ConsoleTopbar from './components/console-topbar/index.vue';
import ConsoleTabs from './components/console-tabs/index.vue';
import ConsoleCopyToast from './components/copy-toast/index.vue';
import DonationCard from './components/donation-card/index.vue';
import InvitesTab from './components/invites-tab/index.vue';
import ProfileTab from './components/profile-tab/index.vue';
import RoomsTab from './components/rooms-tab/index.vue';
import VpnTab from './components/vpn-tab/index.vue';
import {resolveMediaUrl} from '@/composables/media-url';
import {emit} from '@/composables/event-bus';
import {loadLastChatPath} from '@/composables/last-chat';
import {ws} from '@/composables/classes/ws';
import {getSessionToken, restoreSession, wsChangePassword, wsData, wsObject, wsProvisionVpn, wsSetVpnDonation, wsUpdateProfile} from '@/composables/ws-rpc';
import {
  BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SOUND_ENABLED_STORAGE_KEY,
  VIBRATION_ENABLED_STORAGE_KEY,
  WEB_PUSH_ENABLED_STORAGE_KEY,
  loadBooleanSetting,
  persistBooleanSetting,
} from '@/pages/chat/helpers/storage';
import {
  fetchWebPushServerConfig,
  getWebPushPermission,
  isIosForWebPush,
  isStandaloneDisplayMode,
  isWebPushSupported,
  sendWebPushTest,
  subscribeWebPush,
  unsubscribeWebPush,
} from '@/composables/use-web-push';

const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_MTPROXY_DEEP_LINK = 'tg://proxy?server=151.245.137.79&port=8443&secret=c6fab0c23452644261db3661aa963f50';
const DEFAULT_MTPROXY_WEB_LINK = 'https://t.me/proxy?server=151.245.137.79&port=8443&secret=c6fab0c23452644261db3661aa963f50';
const DONATION_UNDO_WINDOW_MS = 5 * 60 * 1000;
const MAX_UPLOAD_IMAGE_BYTES = 50 * 1024 * 1024;
const AVATAR_CROP_STAGE_SIZE = 280;
const AVATAR_CROP_VISIBLE_SIZE = 232;
const AVATAR_CROP_EXPORT_SIZE = 1024;
const AVATAR_CROP_SCALE_MAX_MULTIPLIER = 6;

type ConsoleTab = 'user' | 'rooms' | 'vpn' | 'invites';
type VpnProvisionState = 'idle' | 'loading' | 'success' | 'error';
type AvatarCropTarget = 'profile' | 'room' | 'roomCreate';

const clampNumber = (valueRaw: unknown, minRaw: unknown, maxRaw: unknown) => {
  const value = Number(valueRaw);
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(value)) return Number.isFinite(min) ? min : 0;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
};

export default {
  components: {
    AvatarCropModal,
    ConsoleMediaViewer,
    ConsoleTabs,
    ConsoleTopbar,
    ConsoleCopyToast,
    DonationCard,
    InvitesTab,
    ProfileTab,
    RoomsTab,
    VpnTab,
  },

  async setup() {
    const route = useRoute();
    const router = useRouter();
    const runtimeConfig = useRuntimeConfig();
    const vpnConfig = (runtimeConfig.public as any)?.vpn || {};
    const amneziaFiles = vpnConfig.amneziaFiles || {};

    return {
      route,
      router,
      config: runtimeConfig,
      activeTab: ref<ConsoleTab>('user'),
      appMode: String(runtimeConfig.public.mode || '').trim().toLowerCase(),
      me: ref<any | null>(null),
      profile: ref<any | null>(null),
      loading: ref(true),
      error: ref(''),

      contacts: ref<any[]>([]),
      contactBusy: ref(false),
      saving: ref(false),
      saveError: ref(''),
      saveSuccess: ref(''),
      profileName: ref(''),
      profileInfo: ref(''),
      profileNicknameColor: ref(''),
      profileColorPicker: ref('#61afef'),
      profileAvatarPath: ref<string | null>(null),
      pushDisableAllMentions: ref(false),
      newPassword: ref(''),
      soundEnabled: ref(true),
      vibrationEnabled: ref(true),
      browserNotificationsEnabled: ref(true),
      browserNotificationPermission: ref<'default' | 'denied' | 'granted'>('default'),
      webPushSupported: ref(false),
      webPushAvailable: ref(false),
      webPushSettingEnabled: ref(true),
      webPushEnabled: ref(false),
      webPushBusy: ref(false),
      webPushTestBusy: ref(false),
      webPushPermission: ref<'default' | 'denied' | 'granted'>('default'),
      webPushError: ref(''),
      webPushTestStatus: ref(''),
      webPushRequiresIosInstall: ref(false),
      webPushVapidPublicKey: ref(''),

      roomsLoading: ref(false),
      roomsError: ref(''),
      allRooms: ref<any[]>([]),
      selectedRoom: ref<any | null>(null),
      roomMembers: ref<any[]>([]),
      roomMembersLoading: ref(false),
      roomTitle: ref(''),
      roomVisibility: ref<'public' | 'private'>('public'),
      roomCommentsEnabled: ref(true),
      roomPostOnlyByAdmin: ref(false),
      roomAvatarPath: ref<string | null>(null),
      roomSaving: ref(false),
      roomSaveError: ref(''),
      roomSaveSuccess: ref(''),
      roomCreating: ref(false),
      roomCreateFormOpen: ref(false),
      roomCreateTitle: ref(''),
      roomCreateVisibility: ref<'public' | 'private'>('public'),
      roomCreateCommentsEnabled: ref(true),
      roomCreatePostOnlyByAdmin: ref(false),
      roomCreateAvatarPath: ref<string | null>(null),
      roomDeleteBusy: ref(false),
      roomLeaveBusy: ref(false),
      roomMemberActionBusyIds: ref<number[]>([]),

      isAuthed: ref(false),
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

      inviteRoomsLoading: ref(false),
      inviteRooms: ref<Array<{roomId: number; title: string; visibility: 'public' | 'private'; checkedByDefault: boolean}>>([]),
      selectedInviteRoomIds: ref<number[]>([]),
      inviteCreating: ref(false),
      inviteError: ref(''),
      lastInviteLink: ref(''),
      invites: ref<any[]>([]),

      avatarCropVisible: ref(false),
      avatarCropBusy: ref(false),
      avatarCropSourceUrl: ref(''),
      avatarCropFileMime: ref('image/jpeg'),
      avatarCropFileName: ref(''),
      avatarCropTarget: ref<AvatarCropTarget | ''>(''),
      avatarCropNaturalWidth: ref(0),
      avatarCropNaturalHeight: ref(0),
      avatarCropScale: ref(1),
      avatarCropMinScale: ref(1),
      avatarCropX: ref(0),
      avatarCropY: ref(0),
      avatarCropDragging: ref(false),
      avatarCropPointerId: ref<number | null>(null),
      avatarCropDragStartPointerX: ref(0),
      avatarCropDragStartPointerY: ref(0),
      avatarCropDragStartX: ref(0),
      avatarCropDragStartY: ref(0),
      avatarCropOverlayCloseBlockedUntilTs: ref(0),
      mediaViewerVisible: ref(false),
      mediaViewerSrc: ref(''),
      mediaViewerAlt: ref(''),
      copyToastVisible: ref(false),
      copyToastText: ref('Текст скопирован'),
      copyToastTimer: ref<number | null>(null),
    };
  },

  computed: {
    isOwnProfile(this: any) {
      return Number(this.me?.id || 0) > 0 && Number(this.me?.id) === Number(this.profile?.id || 0);
    },

    isContact(this: any) {
      const profileId = Number(this.profile?.id || 0);
      if (!Number.isFinite(profileId) || profileId <= 0) return false;
      return this.contacts.some((user: any) => Number(user?.id || 0) === profileId);
    },

    hasDonationBadge(this: any) {
      const until = String(this.profile?.donationBadgeUntil || '').trim();
      return !!until && Date.parse(until) > Date.now();
    },

    profileDisplayName(this: any) {
      if (!this.profile) return '';
      if (this.isOwnProfile) {
        const ownName = String(this.profileName || '').trim();
        if (ownName) return ownName;
      }
      return String(this.profile?.name || this.profile?.nickname || '');
    },

    profileDisplayNicknameColor(this: any) {
      if (!this.profile) return null;
      if (!this.isOwnProfile) return this.profile?.nicknameColor || null;
      const color = String(this.profileNicknameColor || '').trim().toLowerCase();
      if (!color) return null;
      if (!COLOR_HEX_RE.test(color)) return this.profile?.nicknameColor || null;
      return color;
    },

    profileDisplayAvatarUrl(this: any) {
      if (!this.profile) return '';
      const path = this.isOwnProfile
        ? (this.profileAvatarPath || this.profile?.avatarUrl || '')
        : (this.profile?.avatarUrl || '');
      return resolveMediaUrl(path);
    },

    isDevMode(this: any) {
      return this.appMode === 'dev';
    },

    isStandaloneApp() {
      if (typeof window === 'undefined') return false;
      return isStandaloneDisplayMode();
    },

    webPushStatusText(this: any) {
      if (!this.webPushSupported) return 'не поддерживается';
      if (!this.webPushAvailable) return 'выключен на сервере';
      if (this.webPushEnabled) return 'включён';
      return 'выключен';
    },

    canSendWebPushTest(this: any) {
      return this.webPushPermission === 'granted' || this.webPushEnabled;
    },

    consoleUserTabLabel(this: any) {
      return String(this.profile?.name || this.me?.name || this.me?.nickname || 'Профиль');
    },

    roomsTabOwnerLabel(this: any) {
      if (this.profile?.id && this.profile?.id !== this.me?.id) {
        return `Комнаты ${this.profile.name || this.profile.nickname}`;
      }
      return 'Мои комнаты';
    },

    roomsTabList(this: any) {
      const ownerId = Number((this.profile?.id || this.me?.id || 0));
      if (!Number.isFinite(ownerId) || ownerId <= 0) return [];
      return this.allRooms.filter((room: any) => Number(room?.createdById || 0) === ownerId);
    },

    selectedRoomDisplayTitle(this: any) {
      if (!this.selectedRoom) return 'Комната';
      if (this.canEditSelectedRoom) {
        const ownTitle = String(this.roomTitle || '').trim();
        if (ownTitle) return ownTitle;
      }
      return String(this.selectedRoom?.title || 'Комната');
    },

    selectedRoomDisplayAvatarUrl(this: any) {
      if (!this.selectedRoom) return '';
      const path = this.canEditSelectedRoom
        ? (this.roomAvatarPath || this.selectedRoom?.avatarUrl || '')
        : (this.selectedRoom?.avatarUrl || '');
      return resolveMediaUrl(path);
    },

    canEditSelectedRoom(this: any) {
      const selectedRoomId = Number(this.selectedRoom?.id || 0);
      if (!Number.isFinite(selectedRoomId) || selectedRoomId <= 0) return false;
      return Number(this.selectedRoom?.createdById || 0) === Number(this.me?.id || 0);
    },

    canLeaveSelectedRoom(this: any) {
      const selectedRoomId = Number(this.selectedRoom?.id || 0);
      if (!Number.isFinite(selectedRoomId) || selectedRoomId <= 0) return false;
      if (this.canEditSelectedRoom) return false;
      if (String(this.selectedRoom?.title || '').trim() === 'Новости MARX' && !!this.selectedRoom?.postOnlyByAdmin) {
        return false;
      }
      const meId = Number(this.me?.id || 0);
      if (!Number.isFinite(meId) || meId <= 0) return false;
      return this.roomMembers.some((member: any) => Number(member?.id || 0) === meId);
    },

    sortedRoomMembers(this: any) {
      const list = Array.isArray(this.roomMembers) ? [...this.roomMembers] : [];
      list.sort((left: any, right: any) => {
        const leftOnline = !!left?.isOnline;
        const rightOnline = !!right?.isOnline;
        if (leftOnline !== rightOnline) return leftOnline ? -1 : 1;

        const leftName = String(left?.name || left?.nickname || '').toLowerCase();
        const rightName = String(right?.name || right?.nickname || '').toLowerCase();
        if (leftName !== rightName) return leftName.localeCompare(rightName);
        return Number(left?.id || 0) - Number(right?.id || 0);
      });
      return list;
    },

    avatarCropMaxScale(this: any) {
      const minScale = Math.max(0.0001, Number(this.avatarCropMinScale || 1));
      return minScale * AVATAR_CROP_SCALE_MAX_MULTIPLIER;
    },

    avatarCropScalePercent(this: any) {
      const minScale = Math.max(0.0001, Number(this.avatarCropMinScale || 1));
      const ratio = Number(this.avatarCropScale || minScale) / minScale;
      return Math.max(100, Math.round(ratio * 100));
    },

    avatarCropImageStyle(this: any) {
      const metrics = this.getAvatarCropRenderMetrics();
      return {
        width: `${metrics.displayWidth}px`,
        height: `${metrics.displayHeight}px`,
        transform: `translate3d(${metrics.imageX}px, ${metrics.imageY}px, 0)`,
      };
    },

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
      return this.donationButtonUndoMode ? 'Ой, т.е. не отправил...' : 'Я отправил пожертвование!';
    },
  },

  watch: {
    'route.fullPath'(this: any) {
      void this.syncFromRoute();
    },
  },

  methods: {
    showCopyToast(this: any, textRaw?: unknown) {
      const text = String(textRaw || 'Текст скопирован').trim() || 'Текст скопирован';
      this.copyToastText = text;
      this.copyToastVisible = true;
      if (this.copyToastTimer) {
        clearTimeout(this.copyToastTimer);
      }
      this.copyToastTimer = window.setTimeout(() => {
        this.copyToastVisible = false;
        this.copyToastTimer = null;
      }, 2200);
    },

    openMediaViewer(this: any, srcRaw: unknown, altRaw?: unknown) {
      const src = resolveMediaUrl(srcRaw);
      if (!src) return;
      this.mediaViewerSrc = src;
      this.mediaViewerAlt = String(altRaw || '').trim();
      this.mediaViewerVisible = true;
    },

    closeMediaViewer(this: any) {
      this.mediaViewerVisible = false;
      this.mediaViewerSrc = '';
      this.mediaViewerAlt = '';
    },

    normalizeTab(this: any, raw: unknown): ConsoleTab {
      const value = String(raw || '').trim().toLowerCase();
      return value === 'rooms' || value === 'vpn' || value === 'invites' ? value : 'user';
    },

    routeNickname(this: any) {
      const raw = Array.isArray(this.route?.query?.nickname) ? this.route.query.nickname[0] : this.route?.query?.nickname;
      return String(raw || '').trim().toLowerCase();
    },

    routeRoomId(this: any) {
      const raw = Array.isArray(this.route?.query?.roomId) ? this.route.query.roomId[0] : this.route?.query?.roomId;
      const parsed = Number.parseInt(String(raw ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },

    async updateRoute(this: any, patchRaw: Record<string, unknown>) {
      const nextQuery: Record<string, any> = {...(this.route?.query || {})};
      Object.entries(patchRaw || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          delete nextQuery[key];
        } else {
          nextQuery[key] = String(value);
        }
      });
      await this.router.replace({path: '/console', query: nextQuery});
    },

    async setActiveTab(this: any, tabRaw: unknown) {
      const tab = this.normalizeTab(tabRaw);
      await this.updateRoute({tab});
    },

    userAvatarFallback(this: any, user: any) {
      return ((user?.name || user?.nickname || '?').trim().charAt(0) || '?').toUpperCase();
    },

    resolveMediaUrl(this: any, raw: unknown) {
      return resolveMediaUrl(raw);
    },

    resolveUserAvatarUrl(this: any, user: any) {
      return resolveMediaUrl(user?.avatarUrl);
    },

    roomAvatarFallback(this: any, room: any) {
      return ((room?.title || 'К').trim().charAt(0) || 'К').toUpperCase();
    },

    resolveRoomAvatarUrl(this: any, room: any) {
      return resolveMediaUrl(room?.avatarUrl);
    },

    isSystemNickname(this: any, nicknameRaw: unknown) {
      return String(nicknameRaw || '').trim().toLowerCase() === 'marx';
    },

    async goBack(this: any) {
      await this.router.push(loadLastChatPath());
    },

    async ensureAuth(this: any) {
      const session = await restoreSession();
      const data = wsObject(session);
      if (!(session as any)?.ok || !data.user?.id) {
        await this.router.push('/login');
        return false;
      }
      this.me = data.user;
      this.isAuthed = true;
      return true;
    },

    normalizeRoom(this: any, raw: any) {
      const roomId = Number(raw?.roomId || raw?.id || raw?.dialogId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return null;
      return {
        id: roomId,
        title: String(raw?.title || 'Комната'),
        visibility: raw?.visibility === 'private' ? 'private' : 'public',
        commentsEnabled: raw?.commentsEnabled !== undefined ? !!raw.commentsEnabled : true,
        avatarUrl: raw?.avatarUrl ? String(raw.avatarUrl) : null,
        postOnlyByAdmin: !!raw?.postOnlyByAdmin,
        createdById: Number(raw?.createdById || 0) || null,
      };
    },

    async copyToClipboard(this: any, valueRaw: unknown) {
      const value = String(valueRaw || '').trim();
      if (!value) return false;

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          this.showCopyToast('Текст скопирован');
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
        this.showCopyToast('Текст скопирован');
        return true;
      } catch {
        return false;
      }
    },

    extractUploadErrorCode(this: any, response: Response | null, resultRaw: any) {
      const result = resultRaw && typeof resultRaw === 'object' ? resultRaw : {};
      const messageRaw = Array.isArray(result?.message)
        ? result.message.join(' ')
        : String(result?.message || '');
      const errorRaw = String(result?.error || '');
      const merged = `${messageRaw} ${errorRaw}`.toLowerCase();
      if (merged.includes('file_too_large')) return 'file_too_large';
      if (merged.includes('invalid_file_type')) return 'invalid_file_type';
      if (merged.includes('unauthorized') || response?.status === 401) return 'unauthorized';
      return '';
    },

    async canvasToBlob(this: any, canvas: HTMLCanvasElement, mime: string, quality: number) {
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mime, quality);
      });
    },

    loadImageFromUrl(this: any, sourceUrlRaw: unknown) {
      const sourceUrl = String(sourceUrlRaw || '').trim();
      return new Promise<HTMLImageElement>((resolve, reject) => {
        if (!sourceUrl) {
          reject(new Error('invalid_image_source'));
          return;
        }
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('image_decode_failed'));
        image.src = sourceUrl;
      });
    },

    releaseAvatarCropSource(this: any) {
      const sourceUrl = String(this.avatarCropSourceUrl || '').trim();
      if (sourceUrl.startsWith('blob:')) {
        URL.revokeObjectURL(sourceUrl);
      }
      this.avatarCropSourceUrl = '';
    },

    getAvatarCropBounds(this: any) {
      const metrics = this.getAvatarCropRenderMetrics();
      const cropLeft = (AVATAR_CROP_STAGE_SIZE - AVATAR_CROP_VISIBLE_SIZE) / 2;
      const cropTop = (AVATAR_CROP_STAGE_SIZE - AVATAR_CROP_VISIBLE_SIZE) / 2;
      const minX = cropLeft + AVATAR_CROP_VISIBLE_SIZE - metrics.displayWidth;
      const maxX = cropLeft;
      const minY = cropTop + AVATAR_CROP_VISIBLE_SIZE - metrics.displayHeight;
      const maxY = cropTop;
      return {
        displayWidth: metrics.displayWidth,
        displayHeight: metrics.displayHeight,
        cropLeft,
        cropTop,
        minX,
        maxX,
        minY,
        maxY,
      };
    },

    getAvatarCropRenderMetrics(this: any) {
      const naturalWidth = Math.max(1, Number(this.avatarCropNaturalWidth || 1));
      const naturalHeight = Math.max(1, Number(this.avatarCropNaturalHeight || 1));
      const scale = Math.max(0.0001, Number(this.avatarCropScale || 1));
      const displayWidth = Math.max(1, Math.floor(naturalWidth * scale));
      const displayHeight = Math.max(1, Math.floor(naturalHeight * scale));
      return {
        naturalWidth,
        naturalHeight,
        displayWidth,
        displayHeight,
        imageX: Math.round(Number(this.avatarCropX || 0)),
        imageY: Math.round(Number(this.avatarCropY || 0)),
      };
    },

    clampAvatarCropPosition(this: any) {
      const bounds = this.getAvatarCropBounds();
      this.avatarCropX = clampNumber(this.avatarCropX, bounds.minX, bounds.maxX);
      this.avatarCropY = clampNumber(this.avatarCropY, bounds.minY, bounds.maxY);
    },

    blockAvatarCropOverlayClose(this: any, timeoutMsRaw?: unknown) {
      const timeoutMs = Math.max(0, Number(timeoutMsRaw || 220));
      this.avatarCropOverlayCloseBlockedUntilTs = Date.now() + timeoutMs;
    },

    resetAvatarCropDrag(this: any) {
      this.avatarCropDragging = false;
      this.avatarCropPointerId = null;
      this.avatarCropDragStartPointerX = 0;
      this.avatarCropDragStartPointerY = 0;
      this.avatarCropDragStartX = 0;
      this.avatarCropDragStartY = 0;
    },

    closeAvatarCropper(this: any) {
      this.avatarCropVisible = false;
      this.avatarCropBusy = false;
      this.avatarCropTarget = '';
      this.avatarCropFileName = '';
      this.avatarCropFileMime = 'image/jpeg';
      this.avatarCropNaturalWidth = 0;
      this.avatarCropNaturalHeight = 0;
      this.avatarCropScale = 1;
      this.avatarCropMinScale = 1;
      this.avatarCropX = 0;
      this.avatarCropY = 0;
      this.avatarCropOverlayCloseBlockedUntilTs = 0;
      this.resetAvatarCropDrag();
      this.releaseAvatarCropSource();
    },

    initializeAvatarCropByImage(this: any, image: HTMLImageElement) {
      const naturalWidth = Math.max(1, Number(image.naturalWidth || 1));
      const naturalHeight = Math.max(1, Number(image.naturalHeight || 1));
      const cropSize = AVATAR_CROP_VISIBLE_SIZE;
      const minScale = Math.max(cropSize / naturalWidth, cropSize / naturalHeight);
      const cropLeft = (AVATAR_CROP_STAGE_SIZE - cropSize) / 2;
      const cropTop = (AVATAR_CROP_STAGE_SIZE - cropSize) / 2;

      this.avatarCropNaturalWidth = naturalWidth;
      this.avatarCropNaturalHeight = naturalHeight;
      this.avatarCropMinScale = minScale;
      this.avatarCropScale = minScale;
      const metrics = this.getAvatarCropRenderMetrics();
      this.avatarCropX = cropLeft + (cropSize - metrics.displayWidth) / 2;
      this.avatarCropY = cropTop + (cropSize - metrics.displayHeight) / 2;
      this.clampAvatarCropPosition();
    },

    async openAvatarCropper(this: any, fileRaw: File | null | undefined, target: AvatarCropTarget) {
      const file = fileRaw instanceof File ? fileRaw : null;
      if (!file) return;

      const mime = String(file.type || '').trim().toLowerCase();
      if (!mime.startsWith('image/')) {
        this.error = 'Не удалось загрузить файл.';
        return;
      }
      if (Number(file.size || 0) <= 0) {
        this.error = 'Не удалось загрузить файл.';
        return;
      }
      if (Number(file.size || 0) > MAX_UPLOAD_IMAGE_BYTES) {
        this.error = 'Файл слишком большой.';
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      try {
        const image = await this.loadImageFromUrl(objectUrl);
        this.releaseAvatarCropSource();
        this.error = '';
        this.avatarCropVisible = true;
        this.avatarCropBusy = false;
        this.avatarCropTarget = target;
        this.avatarCropSourceUrl = objectUrl;
        this.avatarCropFileMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
        this.avatarCropFileName = String(file.name || '').trim() || `avatar-${Date.now()}`;
        this.avatarCropOverlayCloseBlockedUntilTs = 0;
        this.initializeAvatarCropByImage(image);
      } catch {
        URL.revokeObjectURL(objectUrl);
        this.error = 'Не удалось загрузить файл.';
      }
    },

    onAvatarCropOverlayClick(this: any) {
      if (this.avatarCropDragging) return;
      if (Date.now() < Number(this.avatarCropOverlayCloseBlockedUntilTs || 0)) return;
      this.closeAvatarCropper();
    },

    onAvatarCropPointerDown(this: any, event: PointerEvent) {
      if (!this.avatarCropVisible || this.avatarCropBusy) return;
      if (!this.avatarCropSourceUrl) return;
      this.avatarCropDragging = true;
      this.avatarCropPointerId = Number(event.pointerId);
      this.avatarCropDragStartPointerX = Number(event.clientX || 0);
      this.avatarCropDragStartPointerY = Number(event.clientY || 0);
      this.avatarCropDragStartX = Number(this.avatarCropX || 0);
      this.avatarCropDragStartY = Number(this.avatarCropY || 0);
      this.blockAvatarCropOverlayClose(260);

      const stage = event.currentTarget as HTMLElement | null;
      if (stage && typeof stage.setPointerCapture === 'function') {
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {}
      }
    },

    onAvatarCropPointerMove(this: any, event: PointerEvent) {
      if (!this.avatarCropDragging) return;
      const pointerId = Number(this.avatarCropPointerId);
      if (Number.isFinite(pointerId) && pointerId > 0 && Number(event.pointerId) !== pointerId) return;

      const deltaX = Number(event.clientX || 0) - Number(this.avatarCropDragStartPointerX || 0);
      const deltaY = Number(event.clientY || 0) - Number(this.avatarCropDragStartPointerY || 0);
      this.avatarCropX = Number(this.avatarCropDragStartX || 0) + deltaX;
      this.avatarCropY = Number(this.avatarCropDragStartY || 0) + deltaY;
      this.clampAvatarCropPosition();
    },

    onAvatarCropPointerUp(this: any, event?: PointerEvent) {
      if (!this.avatarCropDragging) return;
      const pointerId = Number(this.avatarCropPointerId);
      if (event && Number.isFinite(pointerId) && pointerId > 0 && Number(event.pointerId) !== pointerId) return;
      this.resetAvatarCropDrag();
      this.blockAvatarCropOverlayClose(260);
    },

    onAvatarCropScaleInput(this: any, event: Event) {
      const input = event.target as HTMLInputElement | null;
      const minScale = Number(this.avatarCropMinScale || 1);
      const maxScale = Number(this.avatarCropMaxScale || minScale);
      const nextScale = clampNumber(Number(input?.value || minScale), minScale, maxScale);
      const previousScale = Math.max(0.0001, Number(this.avatarCropScale || minScale));
      const centerX = AVATAR_CROP_STAGE_SIZE / 2;
      const centerY = AVATAR_CROP_STAGE_SIZE / 2;
      const offsetX = centerX - Number(this.avatarCropX || 0);
      const offsetY = centerY - Number(this.avatarCropY || 0);
      const ratio = nextScale / previousScale;

      this.avatarCropScale = nextScale;
      this.avatarCropX = centerX - (offsetX * ratio);
      this.avatarCropY = centerY - (offsetY * ratio);
      this.clampAvatarCropPosition();
    },

    async renderAvatarCroppedBlob(this: any) {
      const sourceUrl = String(this.avatarCropSourceUrl || '').trim();
      if (!sourceUrl) return null;

      const image = await this.loadImageFromUrl(sourceUrl);
      const stageCanvas = document.createElement('canvas');
      stageCanvas.width = AVATAR_CROP_STAGE_SIZE;
      stageCanvas.height = AVATAR_CROP_STAGE_SIZE;
      const stageCtx = stageCanvas.getContext('2d');
      if (!stageCtx) return null;
      stageCtx.imageSmoothingEnabled = true;
      stageCtx.imageSmoothingQuality = 'high';

      const metrics = this.getAvatarCropRenderMetrics();
      stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
      stageCtx.drawImage(
        image,
        metrics.imageX,
        metrics.imageY,
        metrics.displayWidth,
        metrics.displayHeight,
      );

      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_CROP_EXPORT_SIZE;
      canvas.height = AVATAR_CROP_EXPORT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const cropLeft = (AVATAR_CROP_STAGE_SIZE - AVATAR_CROP_VISIBLE_SIZE) / 2;
      const cropTop = (AVATAR_CROP_STAGE_SIZE - AVATAR_CROP_VISIBLE_SIZE) / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        stageCanvas,
        cropLeft,
        cropTop,
        AVATAR_CROP_VISIBLE_SIZE,
        AVATAR_CROP_VISIBLE_SIZE,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      let mime = this.avatarCropFileMime === 'image/png' ? 'image/png' : 'image/jpeg';
      let quality = 0.92;
      let blob = await this.canvasToBlob(canvas, mime, quality);
      if (!blob) return null;

      if (blob.size > MAX_UPLOAD_IMAGE_BYTES) {
        mime = 'image/jpeg';
        quality = 0.9;
        blob = await this.canvasToBlob(canvas, mime, quality);
      }
      if (!blob) return null;

      while (blob.size > MAX_UPLOAD_IMAGE_BYTES && quality > 0.46) {
        quality = Math.max(0.46, quality - 0.12);
        const nextBlob = await this.canvasToBlob(canvas, mime, quality);
        if (!nextBlob) break;
        blob = nextBlob;
      }

      if (blob.size > MAX_UPLOAD_IMAGE_BYTES) return null;
      return blob;
    },

    buildAvatarUploadFile(this: any, blob: Blob) {
      const baseName = String(this.avatarCropFileName || 'avatar')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        || `avatar-${Date.now()}`;
      const ext = blob.type === 'image/png' ? '.png' : '.jpg';
      return new File([blob], `${baseName}${ext}`, {
        type: blob.type || 'image/jpeg',
        lastModified: Date.now(),
      });
    },

    applyAvatarPathForTarget(this: any, targetRaw: unknown, pathRaw: unknown) {
      const target = String(targetRaw || '') as AvatarCropTarget;
      const path = String(pathRaw || '').trim();
      if (!path) return;
      if (target === 'profile') {
        this.profileAvatarPath = path;
      } else if (target === 'room') {
        this.roomAvatarPath = path;
      } else if (target === 'roomCreate') {
        this.roomCreateAvatarPath = path;
      }
    },

    async finalizeAvatarCropAndUpload(this: any) {
      if (this.avatarCropBusy || !this.avatarCropVisible) return;
      if (!this.avatarCropTarget) return;
      this.avatarCropBusy = true;
      try {
        const croppedBlob = await this.renderAvatarCroppedBlob();
        if (!croppedBlob) {
          this.error = 'Не удалось загрузить файл.';
          return;
        }
        const uploadFile = this.buildAvatarUploadFile(croppedBlob);
        const path = await this.uploadImageFile(uploadFile);
        if (!path) return;
        this.applyAvatarPathForTarget(this.avatarCropTarget, path);
        this.closeAvatarCropper();
      } finally {
        this.avatarCropBusy = false;
      }
    },

    async uploadImageFile(this: any, fileRaw: File | null | undefined) {
      const file = fileRaw instanceof File ? fileRaw : null;
      if (!file) return null;

      if (Number(file.size || 0) <= 0) {
        this.error = 'Не удалось загрузить файл.';
        return null;
      }
      if (Number(file.size || 0) > MAX_UPLOAD_IMAGE_BYTES) {
        this.error = 'Файл слишком большой.';
        return null;
      }

      const token = String(getSessionToken() || '').trim();
      if (!token) {
        this.error = 'Сессия истекла.';
        return null;
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${getApiBase()}/upload/media`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const result = await response.json().catch(() => null);
        const errorCode = this.extractUploadErrorCode(response, result);
        if (!response.ok || !result?.ok || !String(result.path || '').trim()) {
          if (errorCode === 'file_too_large') {
            this.error = 'Файл слишком большой.';
          } else if (errorCode === 'unauthorized') {
            this.error = 'Сессия истекла.';
          } else {
            this.error = 'Не удалось загрузить файл.';
          }
          return null;
        }
        return String(result.path || '').trim();
      } catch {
        this.error = 'Не удалось загрузить файл.';
        return null;
      }
    },

    fillOwnForm(this: any) {
      if (!this.profile) return;
      this.profileName = this.profile.name || this.profile.nickname || '';
      this.profileInfo = this.profile.info || '';
      this.profileNicknameColor = this.profile.nicknameColor || '';
      this.profileColorPicker = this.profile.nicknameColor || '#61afef';
      this.profileAvatarPath = this.profile.avatarUrl || null;
      this.pushDisableAllMentions = !!this.profile.pushDisableAllMentions;
    },

    applyRoomForm(this: any, room: any) {
      this.roomTitle = String(room?.title || 'Комната');
      this.roomVisibility = room?.visibility === 'private' ? 'private' : 'public';
      this.roomCommentsEnabled = room?.commentsEnabled !== undefined ? !!room.commentsEnabled : true;
      this.roomPostOnlyByAdmin = !!room?.postOnlyByAdmin;
      this.roomAvatarPath = room?.avatarUrl ? String(room.avatarUrl) : null;
    },

    clearNicknameColor(this: any) {
      this.profileNicknameColor = '';
      this.profileColorPicker = '#61afef';
    },

    onColorPicked(this: any) {
      this.profileNicknameColor = String(this.profileColorPicker || '').trim().toLowerCase();
    },

    syncBrowserNotificationPermission(this: any) {
      if (typeof Notification === 'undefined') {
        this.browserNotificationPermission = 'denied';
        return;
      }
      this.browserNotificationPermission = Notification.permission;
    },

    loadLocalSettings(this: any) {
      this.soundEnabled = loadBooleanSetting(SOUND_ENABLED_STORAGE_KEY, true);
      this.vibrationEnabled = loadBooleanSetting(VIBRATION_ENABLED_STORAGE_KEY, true);
      this.browserNotificationsEnabled = loadBooleanSetting(BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY, true);
      this.webPushSettingEnabled = loadBooleanSetting(WEB_PUSH_ENABLED_STORAGE_KEY, true);
      this.syncBrowserNotificationPermission();
    },

    onSoundEnabledChange(this: any) {
      persistBooleanSetting(SOUND_ENABLED_STORAGE_KEY, !!this.soundEnabled);
    },

    onVibrationEnabledChange(this: any) {
      persistBooleanSetting(VIBRATION_ENABLED_STORAGE_KEY, !!this.vibrationEnabled);
    },

    async requestBrowserNotificationPermission(this: any) {
      if (typeof Notification === 'undefined') return;
      try {
        this.browserNotificationPermission = await Notification.requestPermission();
      } catch {
        this.browserNotificationPermission = Notification.permission;
      }
    },

    onBrowserNotificationsEnabledChange(this: any) {
      this.browserNotificationsEnabled = !!this.browserNotificationsEnabled;
      persistBooleanSetting(BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY, !!this.browserNotificationsEnabled);
      if (this.browserNotificationsEnabled && this.browserNotificationPermission === 'default') {
        void this.requestBrowserNotificationPermission();
      }
    },

    async initWebPush(this: any) {
      this.webPushError = '';
      this.webPushTestStatus = '';
      this.webPushSupported = isWebPushSupported();
      this.webPushPermission = getWebPushPermission();
      this.webPushRequiresIosInstall = isIosForWebPush() && !isStandaloneDisplayMode();

      if (!this.webPushSupported) {
        this.webPushAvailable = false;
        this.webPushEnabled = false;
        return;
      }

      const apiBase = getApiBase();
      const serverConfig = await fetchWebPushServerConfig(apiBase);
      this.webPushAvailable = !!serverConfig.enabled;
      this.webPushVapidPublicKey = serverConfig.vapidPublicKey;
      if (!this.webPushAvailable) {
        this.webPushEnabled = false;
        return;
      }

      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (!registration) {
        this.webPushEnabled = false;
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      this.webPushEnabled = !!existing && this.webPushPermission === 'granted';
      if (this.isStandaloneApp && this.webPushSettingEnabled && !this.webPushEnabled && this.webPushPermission !== 'denied') {
        await this.enableWebPush();
      }
    },

    async enableWebPush(this: any) {
      if (this.webPushBusy) return;
      this.webPushBusy = true;
      this.webPushError = '';

      try {
        if (!this.webPushSupported || !this.webPushAvailable || !this.webPushVapidPublicKey) {
          this.webPushError = 'Web Push сейчас недоступен.';
          return;
        }
        if (this.webPushPermission === 'default') {
          await this.requestBrowserNotificationPermission();
          this.webPushPermission = getWebPushPermission();
        }
        if (this.webPushPermission !== 'granted') {
          this.webPushError = 'Без разрешения браузера push не включится.';
          return;
        }

        const result = await subscribeWebPush(getApiBase(), getSessionToken(), this.webPushVapidPublicKey);
        if (!result.ok) {
          this.webPushError = 'Не удалось включить Web Push.';
          return;
        }

        this.webPushEnabled = true;
      } finally {
        this.webPushBusy = false;
      }
    },

    async disableWebPush(this: any) {
      if (this.webPushBusy) return;
      this.webPushBusy = true;
      this.webPushError = '';

      try {
        await unsubscribeWebPush(getApiBase(), getSessionToken());
        this.webPushEnabled = false;
      } finally {
        this.webPushBusy = false;
      }
    },

    onWebPushEnabledChange(this: any) {
      this.webPushSettingEnabled = !!this.webPushSettingEnabled;
      persistBooleanSetting(WEB_PUSH_ENABLED_STORAGE_KEY, !!this.webPushSettingEnabled);
      if (this.webPushSettingEnabled) {
        void this.enableWebPush();
        return;
      }
      void this.disableWebPush();
    },

    async sendWebPushTest(this: any) {
      if (!this.isDevMode || this.webPushTestBusy) return;
      this.webPushTestBusy = true;
      this.webPushError = '';
      this.webPushTestStatus = '';
      try {
        const result = await sendWebPushTest(getApiBase(), getSessionToken());
        if (!result.ok) {
          this.webPushError = 'Тестовый push не отправился.';
          this.webPushTestStatus = 'Ошибка';
          return;
        }
        this.webPushTestStatus = 'Тестовый push отправлен';
      } finally {
        this.webPushTestBusy = false;
      }
    },

    async fetchProfile(this: any) {
      if (!this.isAuthed || !this.me?.id) return;
      this.error = '';
      const nickname = this.routeNickname() || String(this.me?.nickname || '').trim().toLowerCase();
      const result = await ws.request('user:get', {nickname});
      const profile = wsObject(result).user;
      if (!(profile as any)?.id) {
        const ownNickname = String(this.me?.nickname || '').trim().toLowerCase();
        if (nickname === ownNickname && Number(this.me?.id || 0) > 0) {
          this.profile = this.me;
          this.fillOwnForm();
          return;
        }
        this.error = 'Профиль не найден.';
        this.profile = null;
        return;
      }
      this.profile = profile;
      if (this.isOwnProfile) {
        this.fillOwnForm();
      }
    },

    async fetchContacts(this: any) {
      this.contacts = wsData<any[]>(await ws.request('contacts:list'), []);
    },

    async fetchRooms(this: any) {
      this.roomsLoading = true;
      this.roomsError = '';
      try {
        const rows = wsData<any[]>(await ws.request('room:list', {kind: 'group', scope: 'all'}), []);
        this.allRooms = rows.map((row: any) => this.normalizeRoom(row)).filter(Boolean);
      } finally {
        this.roomsLoading = false;
      }
    },

    async fetchSelectedRoom(this: any) {
      const roomId = this.routeRoomId();
      if (!roomId) {
        this.selectedRoom = this.roomsTabList[0] || null;
        if (this.selectedRoom) {
          this.applyRoomForm(this.selectedRoom);
          await this.fetchRoomMembers(this.selectedRoom.id);
        }
        return;
      }

      const result = await ws.request('room:get', {roomId, subscribe: false});
      if (!(result as any)?.ok) {
        this.selectedRoom = null;
        this.roomMembers = [];
        return;
      }

      const data = wsObject(result);
      this.selectedRoom = this.normalizeRoom(data) || {
        id: roomId,
        title: String(data.title || 'Комната'),
        visibility: data.visibility === 'private' ? 'private' : 'public',
        commentsEnabled: data.commentsEnabled !== undefined ? !!data.commentsEnabled : true,
        avatarUrl: data.avatarUrl ? String(data.avatarUrl) : null,
        postOnlyByAdmin: !!data.postOnlyByAdmin,
        createdById: Number(data.createdById || 0) || null,
      };
      this.applyRoomForm(this.selectedRoom);
      await this.fetchRoomMembers(roomId);
    },

    async fetchRoomMembers(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) {
        this.roomMembers = [];
        return;
      }
      this.roomMembersLoading = true;
      try {
        this.roomMembers = wsData<any[]>(await ws.request('room:members:list', {roomId}), []);
      } finally {
        this.roomMembersLoading = false;
      }
    },

    async openRoomTab(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      await this.updateRoute({tab: 'rooms', roomId});
    },

    async onOpenRoomMemberProfile(this: any, memberRaw: any) {
      const nickname = String(memberRaw?.nickname || '').trim().toLowerCase();
      if (!nickname) return;
      await this.updateRoute({tab: 'user', nickname});
    },

    async onGoOwnRoomsForCreate(this: any) {
      const ownNickname = String(this.me?.nickname || '').trim().toLowerCase();
      if (!ownNickname) return;
      await this.updateRoute({
        tab: 'rooms',
        nickname: ownNickname,
        roomId: undefined,
      });
    },

    toggleRoomCreateForm(this: any) {
      if (!this.isOwnProfile) {
        void this.onGoOwnRoomsForCreate();
        return;
      }
      this.roomCreateFormOpen = !this.roomCreateFormOpen;
      this.roomSaveError = '';
    },

    isRoomMemberActionBusy(this: any, userIdRaw: unknown) {
      const userId = Number(userIdRaw || 0);
      if (!Number.isFinite(userId) || userId <= 0) return false;
      return (this.roomMemberActionBusyIds || []).includes(userId);
    },

    canKickRoomMember(this: any, memberRaw: any) {
      if (!this.canEditSelectedRoom) return false;
      const memberId = Number(memberRaw?.id || 0);
      if (!Number.isFinite(memberId) || memberId <= 0) return false;
      if (memberId === Number(this.me?.id || 0)) return false;
      if (memberId === Number(this.selectedRoom?.createdById || 0)) return false;
      return true;
    },

    async onLeaveSelectedRoom(this: any) {
      if (!this.selectedRoom?.id || this.roomLeaveBusy || !this.canLeaveSelectedRoom) return;
      const confirmed = window.confirm('Покинуть комнату? Она исчезнет из твоей навигации.');
      if (!confirmed) return;

      this.roomLeaveBusy = true;
      this.roomSaveError = '';
      this.roomSaveSuccess = '';
      try {
        const roomId = Number(this.selectedRoom.id || 0);
        const result = await ws.request('room:leave', {roomId});
        if (!(result as any)?.ok) {
          this.roomSaveError = 'Не удалось покинуть комнату.';
          return;
        }

        await this.fetchRooms();
        const fallbackRoom = this.roomsTabList[0] || null;
        if (fallbackRoom?.id) {
          await this.updateRoute({tab: 'rooms', roomId: fallbackRoom.id});
          return;
        }
        await this.updateRoute({tab: 'rooms', roomId: undefined});
      } finally {
        this.roomLeaveBusy = false;
      }
    },

    async onDeleteRoom(this: any) {
      if (!this.selectedRoom?.id || this.roomDeleteBusy || !this.canEditSelectedRoom) return;
      const confirmed = window.confirm('Удалить комнату полностью? Это удалит всю переписку у всех участников.');
      if (!confirmed) return;

      this.roomDeleteBusy = true;
      this.roomSaveError = '';
      this.roomSaveSuccess = '';
      try {
        const roomId = Number(this.selectedRoom.id || 0);
        const result = await ws.request('room:delete', {roomId, confirm: true});
        if (!(result as any)?.ok) {
          this.roomSaveError = 'Не удалось удалить комнату.';
          return;
        }

        await this.fetchRooms();
        const fallbackRoom = this.roomsTabList[0] || null;
        if (fallbackRoom?.id) {
          await this.updateRoute({tab: 'rooms', roomId: fallbackRoom.id});
          return;
        }

        this.selectedRoom = null;
        this.roomMembers = [];
        await this.updateRoute({tab: 'rooms', roomId: undefined});
      } finally {
        this.roomDeleteBusy = false;
      }
    },

    async onKickRoomMember(this: any, memberRaw: any) {
      if (!this.selectedRoom?.id || !this.canKickRoomMember(memberRaw)) return;
      const userId = Number(memberRaw?.id || 0);
      if (!Number.isFinite(userId) || userId <= 0) return;
      if (this.isRoomMemberActionBusy(userId)) return;

      const memberName = String(memberRaw?.name || memberRaw?.nickname || `#${userId}`);
      const confirmed = window.confirm(`Выкинуть ${memberName} из комнаты?`);
      if (!confirmed) return;

      this.roomMemberActionBusyIds = [...this.roomMemberActionBusyIds, userId];
      this.roomSaveError = '';
      this.roomSaveSuccess = '';
      try {
        const result = await ws.request('room:members:remove', {
          roomId: this.selectedRoom.id,
          userIds: [userId],
        });
        if (!(result as any)?.ok) {
          this.roomSaveError = 'Не удалось исключить участника.';
          return;
        }
        await this.fetchRoomMembers(this.selectedRoom.id);
        this.roomSaveSuccess = 'Участник исключён.';
      } finally {
        this.roomMemberActionBusyIds = this.roomMemberActionBusyIds.filter((id: number) => id !== userId);
      }
    },

    async onProfileAvatarInputChange(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      const file = target?.files?.[0] || null;
      await this.openAvatarCropper(file, 'profile');
      if (target) target.value = '';
    },

    async onRoomAvatarInputChange(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      const file = target?.files?.[0] || null;
      await this.openAvatarCropper(file, 'room');
      if (target) target.value = '';
    },

    async onCreateRoomAvatarInputChange(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      const file = target?.files?.[0] || null;
      await this.openAvatarCropper(file, 'roomCreate');
      if (target) target.value = '';
    },

    async onSaveProfile(this: any) {
      const name = String(this.profileName || '').trim();
      if (!name) {
        this.saveError = 'Имя не может быть пустым.';
        return;
      }
      const normalizedColor = String(this.profileNicknameColor || '').trim().toLowerCase();
      if (normalizedColor && !COLOR_HEX_RE.test(normalizedColor)) {
        this.saveError = 'Цвет должен быть в формате #RRGGBB.';
        return;
      }

      this.saving = true;
      this.saveError = '';
      this.saveSuccess = '';
      try {
        const profileResult = await wsUpdateProfile({
          name,
          info: String(this.profileInfo || '').trim() || null,
          nicknameColor: normalizedColor || null,
          avatarPath: this.profileAvatarPath || null,
          pushDisableAllMentions: !!this.pushDisableAllMentions,
        });
        if (!(profileResult as any)?.ok) {
          this.saveError = 'Не удалось сохранить профиль.';
          return;
        }

        if (String(this.newPassword || '').trim()) {
          const passwordResult = await wsChangePassword({
            newPassword: String(this.newPassword || ''),
          });
          if (!(passwordResult as any)?.ok) {
            this.saveError = 'Профиль сохранился, но пароль не обновился.';
            return;
          }
          this.newPassword = '';
        }

        await this.fetchProfile();
        this.saveSuccess = 'Сохранено.';
      } finally {
        this.saving = false;
      }
    },

    async onSaveRoom(this: any) {
      if (!this.selectedRoom?.id) return;
      this.roomSaving = true;
      this.roomSaveError = '';
      this.roomSaveSuccess = '';
      try {
        const result = await ws.request('room:settings:update', {
          roomId: this.selectedRoom.id,
          title: String(this.roomTitle || '').trim() || 'Комната',
          visibility: this.roomVisibility,
          commentsEnabled: !!this.roomCommentsEnabled,
          avatarPath: this.roomAvatarPath || null,
          postOnlyByAdmin: !!this.roomPostOnlyByAdmin,
        });
        if (!(result as any)?.ok) {
          this.roomSaveError = 'Не удалось сохранить комнату.';
          return;
        }
        await this.fetchRooms();
        await this.fetchSelectedRoom();
        this.roomSaveSuccess = 'Комната сохранена.';
      } finally {
        this.roomSaving = false;
      }
    },

    async onCreateRoom(this: any) {
      if (this.roomCreating) return;
      this.roomCreating = true;
      this.roomSaveError = '';
      try {
        const result = await ws.request('room:create', {
          title: String(this.roomCreateTitle || '').trim() || 'Комната',
          visibility: this.roomCreateVisibility,
          commentsEnabled: !!this.roomCreateCommentsEnabled,
          avatarPath: this.roomCreateAvatarPath || null,
          postOnlyByAdmin: !!this.roomCreatePostOnlyByAdmin,
        });
        if (!(result as any)?.ok) {
          this.roomSaveError = 'Не удалось создать комнату.';
          return;
        }
        this.roomCreateTitle = '';
        this.roomCreateVisibility = 'public';
        this.roomCreateCommentsEnabled = true;
        this.roomCreatePostOnlyByAdmin = false;
        this.roomCreateAvatarPath = null;
        this.roomCreateFormOpen = false;
        await this.fetchRooms();
        await this.updateRoute({tab: 'rooms', roomId: wsObject(result).roomId});
      } finally {
        this.roomCreating = false;
      }
    },

    async toggleContact(this: any) {
      if (!this.profile?.id || this.contactBusy) return;
      this.contactBusy = true;
      try {
        const command = this.isContact ? 'contacts:remove' : 'contacts:add';
        await ws.request(command, {userId: this.profile.id});
        await this.fetchContacts();
        emit('contacts:updated');
      } finally {
        this.contactBusy = false;
      }
    },

    async onWriteToUser(this: any) {
      if (!this.profile?.nickname) return;
      await this.router.push(`/direct/${this.profile.nickname}`);
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
          this.vpnProvisionState = 'error';
          this.vpnProvisionError = 'Не удалось получить VPN.';
          return;
        }

        const data = wsObject(result);
        const link = String(data.link || '').trim();
        const configText = String(data.configText || '');
        const qrText = String(data.qrText || '').trim();
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
          this.vpnProvisionQrError = 'Не удалось отрисовать QR.';
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

    async fetchVpnInfo(this: any) {
      this.vpnInfoLoading = true;
      this.vpnInfoError = '';
      try {
        const result = await ws.request('public:vpnInfo');
        if (!(result as any)?.ok) {
          this.vpnInfoError = 'Не удалось получить реквизиты.';
          return;
        }
        const data = wsObject(result);
        this.donationPhone = String(data.donationPhone || '').trim();
        this.donationBank = String(data.donationBank || '').trim();
      } catch {
        this.vpnInfoError = 'Сервер недоступен.';
      } finally {
        this.vpnInfoLoading = false;
      }
    },

    async fetchInviteRooms(this: any) {
      if (!this.isAuthed) return;
      this.inviteRoomsLoading = true;
      this.inviteError = '';
      try {
        const result = await ws.request('invites:available-rooms');
        if (!(result as any)?.ok) {
          this.inviteError = 'Не удалось загрузить комнаты для инвайта.';
          return;
        }
        const rows = wsData<any[]>(result, []);
        this.inviteRooms = rows;
        this.selectedInviteRoomIds = rows
          .filter((room: any) => !!room.checkedByDefault)
          .map((room: any) => Number(room.roomId || 0))
          .filter((roomId: number) => Number.isFinite(roomId) && roomId > 0);
      } finally {
        this.inviteRoomsLoading = false;
      }
    },

    async fetchInvites(this: any) {
      if (!this.isAuthed) return;
      this.invites = wsData<any[]>(await ws.request('invites:list'), []);
    },

    buildInviteLink(this: any, codeRaw: unknown) {
      const code = String(codeRaw || '').trim();
      const rawPublicUrl = (this.config.public as any)?.publicUrl || '';
      const publicUrl = rawPublicUrl.trim();
      const origin = publicUrl || window.location.origin;
      return `${origin}/invite/${code}`;
    },

    async copyInviteLink(this: any, linkRaw: unknown) {
      const link = String(linkRaw || '').trim();
      if (!link) return;
      await this.copyToClipboard(link);
    },

    async copyInviteCode(this: any, codeRaw: unknown) {
      await this.copyInviteLink(this.buildInviteLink(codeRaw));
    },

    async onCreateInvite(this: any) {
      if (this.inviteCreating) return;
      this.inviteCreating = true;
      this.inviteError = '';
      try {
        const result = await ws.request('invites:create', {
          roomIds: this.selectedInviteRoomIds,
        });
        const data = wsObject(result);
        if (!data.id || !data.code) {
          this.inviteError = 'Не удалось создать инвайт.';
          return;
        }
        const link = this.buildInviteLink(data.code);
        this.lastInviteLink = link;
        await this.copyInviteLink(link);
        await this.fetchInvites();
      } finally {
        this.inviteCreating = false;
      }
    },

    async onDeleteInvite(this: any, inviteIdRaw: unknown) {
      const inviteId = Number(inviteIdRaw || 0);
      if (!Number.isFinite(inviteId) || inviteId <= 0) return;
      await ws.request('invites:delete', {inviteId});
      await this.fetchInvites();
    },

    async syncFromRoute(this: any) {
      if (!this.isAuthed || !this.me?.id) return;
      this.activeTab = this.normalizeTab(Array.isArray(this.route?.query?.tab) ? this.route.query.tab[0] : this.route?.query?.tab);
      await this.fetchProfile();
      if (!this.isOwnProfile) {
        this.roomCreateFormOpen = false;
      }
      await this.fetchContacts();
      await this.fetchRooms();

      if (this.activeTab === 'rooms') {
        await this.fetchSelectedRoom();
      } else if (this.activeTab === 'invites') {
        await this.fetchInviteRooms();
        await this.fetchInvites();
      } else if (this.activeTab === 'vpn') {
        if (!this.donationPhone && !this.donationBank && !this.vpnInfoLoading) {
          await this.fetchVpnInfo();
        }
      }
    },
  },

  async mounted(this: any) {
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onAvatarCropPointerMove);
      window.addEventListener('pointerup', this.onAvatarCropPointerUp);
      window.addEventListener('pointercancel', this.onAvatarCropPointerUp);
    }

    const ok = await this.ensureAuth();
    if (!ok) return;
    this.loadLocalSettings();
    await Promise.all([
      this.initWebPush(),
      this.fetchVpnInfo(),
    ]);
    this.loading = false;
    await this.syncFromRoute();
  },

  beforeUnmount(this: any) {
    this.clearDonationUndoTimer();
    if (this.copyToastTimer) {
      clearTimeout(this.copyToastTimer);
      this.copyToastTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onAvatarCropPointerMove);
      window.removeEventListener('pointerup', this.onAvatarCropPointerUp);
      window.removeEventListener('pointercancel', this.onAvatarCropPointerUp);
    }
    this.closeAvatarCropper();
  },
};
