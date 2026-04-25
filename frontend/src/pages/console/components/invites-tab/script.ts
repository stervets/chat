import {Copy, Plus, Trash2} from 'lucide-vue-next';

export default {
  components: {
    Copy,
    Plus,
    Trash2,
  },

  props: {
    inviteCreating: Boolean,
    inviteError: {type: String, default: ''},
    inviteRooms: {type: Array, default: () => []},
    inviteRoomsLoading: Boolean,
    invites: {type: Array, default: () => []},
    isAuthed: Boolean,
    lastInviteLink: {type: String, default: ''},
    selectedInviteRoomIds: {type: Array, default: () => []},
  },

  emits: [
    'copy-invite-code',
    'copy-invite-link',
    'create-invite',
    'delete-invite',
    'update:selectedInviteRoomIds',
  ],

  computed: {
    localSelectedInviteRoomIds: {
      get(this: any) {
        return this.selectedInviteRoomIds;
      },
      set(this: any, value: any[]) {
        this.$emit('update:selectedInviteRoomIds', value);
      },
    },
  },

  methods: {
    onCreateInvite(this: any) {
      this.$emit('create-invite');
    },

    copyInviteLink(this: any, link: string) {
      this.$emit('copy-invite-link', link);
    },

    copyInviteCode(this: any, code: string) {
      this.$emit('copy-invite-code', code);
    },

    onDeleteInvite(this: any, inviteId: number) {
      this.$emit('delete-invite', inviteId);
    },
  },
};
