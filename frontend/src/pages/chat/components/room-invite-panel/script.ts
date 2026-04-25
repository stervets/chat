export default {
  props: {
    activeDialog: Object,
    filteredRoomInviteContacts: {type: Array, default: () => []},
    filteredRoomInviteUsers: {type: Array, default: () => []},
    formatUsername: {type: Function, required: true},
    getDonationBadgeStyle: {type: Function, required: true},
    getUserNameStyle: {type: Function, required: true},
    hasDonationBadge: {type: Function, required: true},
    isActiveDialogAdmin: Boolean,
    isRoomInviteSelected: {type: Function, required: true},
    isSystemUser: {type: Function, required: true},
    roomInviteError: String,
    roomInviteLoading: Boolean,
    roomInviteOpen: Boolean,
    roomInviteSearchQuery: {type: String, default: ''},
    roomInviteSelectedIds: {type: Array, default: () => []},
  },

  emits: [
    'close',
    'submit',
    'toggle-selection',
    'update:roomInviteSearchQuery',
  ],

  computed: {
    localRoomInviteSearchQuery: {
      get(this: any) {
        return this.roomInviteSearchQuery;
      },
      set(this: any, value: string) {
        this.$emit('update:roomInviteSearchQuery', value);
      },
    },
  },

  methods: {
    toggleRoomInvitePanel(this: any) {
      this.$emit('close');
    },

    toggleRoomInviteSelection(this: any, userId: number) {
      this.$emit('toggle-selection', userId);
    },

    submitRoomInvite(this: any) {
      this.$emit('submit');
    },
  },
};
