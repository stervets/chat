import {Bell, Menu, Pin, Settings, ShieldCheck, Trash2, UserPlus} from 'lucide-vue-next';

export default {
  components: {
    Bell,
    Menu,
    Pin,
    Settings,
    ShieldCheck,
    Trash2,
    UserPlus,
  },

  props: {
    activeDialog: Object,
    activeDiscussionSourceDeleted: Boolean,
    canBackToDiscussionSource: Boolean,
    canDeleteActiveRoom: Boolean,
    canPinActiveDialog: Boolean,
    getDialogAvatarFallback: {
      type: Function,
      required: true,
    },
    getNotificationAuthorDonationBadgeStyle: {
      type: Function,
      required: true,
    },
    getNotificationBodyPreview: {
      type: Function,
      required: true,
    },
    getNotificationDialogTitle: {
      type: Function,
      required: true,
    },
    formatMessageTime: {
      type: Function,
      required: true,
    },
    hasNotificationAuthorDonationBadge: {
      type: Function,
      required: true,
    },
    isActiveDialogAdmin: Boolean,
    isDiscussionRoom: Boolean,
    isSystemNickname: {
      type: Function,
      required: true,
    },
    navPinPending: Boolean,
    notifications: {
      type: Array,
      default: () => [],
    },
    notificationsMenuOpen: Boolean,
    resolveDialogAvatarUrl: {
      type: Function,
      required: true,
    },
    roomDeletePending: Boolean,
    roomInviteOpen: Boolean,
    unreadNotificationsCount: Number,
    wsConnectionState: String,
    wsOffline: Boolean,
    wsStatusText: String,
  },

  emits: [
    'back-to-discussion-source',
    'clear-notifications',
    'delete-active-room',
    'menu',
    'notification-button-ready',
    'notification-menu-ready',
    'open-active-dialog-info-page',
    'open-notification',
    'open-own-profile-page',
    'open-vpn-page',
    'pin-active-dialog',
    'toggle-notifications-menu',
    'toggle-room-invite-panel',
  ],

  computed: {
    dialogTitle(this: any) {
      if (this.activeDialog?.kind === 'direct') {
        return this.activeDialog?.title || 'Чат';
      }
      return this.activeDialog?.title || 'Общий чат';
    },

    hasSubtitleRow(this: any) {
      return this.canBackToDiscussionSource
        || this.isDiscussionRoom
        || this.activeDiscussionSourceDeleted
        || this.wsOffline;
    },
  },

  mounted(this: any) {
    this.emitNotificationRefs();
  },

  updated(this: any) {
    this.emitNotificationRefs();
  },

  beforeUnmount(this: any) {
    this.$emit('notification-button-ready', null);
    this.$emit('notification-menu-ready', null);
  },

  methods: {
    emitNotificationRefs(this: any) {
      this.$emit('notification-button-ready', this.$refs.notificationButtonEl || null);
      this.$emit('notification-menu-ready', this.$refs.notificationMenuEl || null);
    },

    getAvatarUrl(this: any, dialog: any) {
      return this.resolveDialogAvatarUrl(dialog);
    },

    getAvatarFallback(this: any, dialog: any) {
      return this.getDialogAvatarFallback(dialog);
    },
  },
};
