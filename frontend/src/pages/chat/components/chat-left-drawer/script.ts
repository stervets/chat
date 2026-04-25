export default {
  props: {
    activeDialog: Object,
    filteredDirectDialogs: {type: Array, default: () => []},
    filteredJoinedRooms: {type: Array, default: () => []},
    filteredPublicRooms: {type: Array, default: () => []},
    filteredUsers: {type: Array, default: () => []},
    getDialogAvatarFallback: {type: Function, required: true},
    getDonationBadgeStyle: {type: Function, required: true},
    getUserNameStyle: {type: Function, required: true},
    hasDonationBadge: {type: Function, required: true},
    isCompactLayout: Boolean,
    isDirectDialogUnread: {type: Function, required: true},
    isSystemUser: {type: Function, required: true},
    leftMenuOpen: Boolean,
    leftNavMode: {type: String, default: 'directs'},
    me: Object,
    resolveDialogAvatarUrl: {type: Function, required: true},
    roomSearchQuery: {type: String, default: ''},
    searchQuery: {type: String, default: ''},
    formatUsername: {type: Function, required: true},
  },

  emits: [
    'close',
    'join-public-room',
    'logout',
    'select-direct-dialog',
    'select-room-dialog',
    'select-user',
    'update:leftNavMode',
    'update:roomSearchQuery',
    'update:searchQuery',
  ],

  computed: {
    localLeftNavMode: {
      get(this: any) {
        return this.leftNavMode;
      },
      set(this: any, value: string) {
        this.$emit('update:leftNavMode', value);
      },
    },

    localSearchQuery: {
      get(this: any) {
        return this.searchQuery;
      },
      set(this: any, value: string) {
        this.$emit('update:searchQuery', value);
      },
    },

    localRoomSearchQuery: {
      get(this: any) {
        return this.roomSearchQuery;
      },
      set(this: any, value: string) {
        this.$emit('update:roomSearchQuery', value);
      },
    },
  },

  methods: {
    onCloseLeftMenuClick(this: any) {
      this.$emit('close');
    },

    closeLeftMenu(this: any) {
      this.$emit('close');
    },

    selectDirectDialog(this: any, dialog: any) {
      this.$emit('select-direct-dialog', dialog);
    },

    selectUser(this: any, user: any) {
      this.$emit('select-user', user);
    },

    selectRoomDialog(this: any, dialog: any) {
      this.$emit('select-room-dialog', dialog);
    },

    joinPublicRoom(this: any, dialog: any) {
      this.$emit('join-public-room', dialog);
    },

    onLogout(this: any) {
      this.$emit('logout');
    },
  },
};
