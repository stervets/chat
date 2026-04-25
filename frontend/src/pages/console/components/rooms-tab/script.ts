import {ImagePlus, Plus, Save, UserRoundMinus} from 'lucide-vue-next';

function modelComputed(propName: string, eventName: string) {
  return {
    get(this: any) {
      return this[propName];
    },
    set(this: any, value: any) {
      this.$emit(eventName, value);
    },
  };
}

export default {
  components: {
    ImagePlus,
    Plus,
    Save,
    UserRoundMinus,
  },

  props: {
    canEditSelectedRoom: Boolean,
    canKickRoomMember: {type: Function, required: true},
    canLeaveSelectedRoom: Boolean,
    isOwnProfile: Boolean,
    isRoomMemberActionBusy: {type: Function, required: true},
    isSystemNickname: {type: Function, required: true},
    resolveMediaUrl: {type: Function, required: true},
    resolveRoomAvatarUrl: {type: Function, required: true},
    resolveUserAvatarUrl: {type: Function, required: true},
    roomAvatarFallback: {type: Function, required: true},
    roomCommentsEnabled: Boolean,
    roomCreateAvatarPath: {type: String, default: ''},
    roomCreateCommentsEnabled: Boolean,
    roomCreateFormOpen: Boolean,
    roomCreatePostOnlyByAdmin: Boolean,
    roomCreateTitle: {type: String, default: ''},
    roomCreateVisibility: {type: String, default: 'private'},
    roomCreating: Boolean,
    roomLeaveBusy: Boolean,
    roomMembersLoading: Boolean,
    roomPostOnlyByAdmin: Boolean,
    roomSaveError: {type: String, default: ''},
    roomSaveSuccess: {type: String, default: ''},
    roomSaving: Boolean,
    roomTitle: {type: String, default: ''},
    roomVisibility: {type: String, default: 'private'},
    roomsLoading: Boolean,
    roomsTabList: {type: Array, default: () => []},
    roomsTabOwnerLabel: {type: String, default: 'Комнаты'},
    selectedRoom: Object,
    selectedRoomDisplayAvatarUrl: {type: String, default: ''},
    selectedRoomDisplayTitle: {type: String, default: 'Комната'},
    sortedRoomMembers: {type: Array, default: () => []},
    userAvatarFallback: {type: Function, required: true},
  },

  emits: [
    'create-room',
    'create-room-avatar-change',
    'go-own-rooms-for-create',
    'kick-room-member',
    'leave-selected-room',
    'media-open',
    'open-room-tab',
    'room-avatar-change',
    'save-room',
    'toggle-create-form',
    'update:roomCommentsEnabled',
    'update:roomCreateCommentsEnabled',
    'update:roomCreatePostOnlyByAdmin',
    'update:roomCreateTitle',
    'update:roomCreateVisibility',
    'update:roomPostOnlyByAdmin',
    'update:roomTitle',
    'update:roomVisibility',
  ],

  computed: {
    localRoomCommentsEnabled: modelComputed('roomCommentsEnabled', 'update:roomCommentsEnabled'),
    localRoomCreateCommentsEnabled: modelComputed('roomCreateCommentsEnabled', 'update:roomCreateCommentsEnabled'),
    localRoomCreatePostOnlyByAdmin: modelComputed('roomCreatePostOnlyByAdmin', 'update:roomCreatePostOnlyByAdmin'),
    localRoomCreateTitle: modelComputed('roomCreateTitle', 'update:roomCreateTitle'),
    localRoomCreateVisibility: modelComputed('roomCreateVisibility', 'update:roomCreateVisibility'),
    localRoomPostOnlyByAdmin: modelComputed('roomPostOnlyByAdmin', 'update:roomPostOnlyByAdmin'),
    localRoomTitle: modelComputed('roomTitle', 'update:roomTitle'),
    localRoomVisibility: modelComputed('roomVisibility', 'update:roomVisibility'),
  },

  methods: {
    openRoomTab(this: any, roomId: number) {
      this.$emit('open-room-tab', roomId);
    },

    toggleRoomCreateForm(this: any) {
      this.$emit('toggle-create-form');
    },

    onGoOwnRoomsForCreate(this: any) {
      this.$emit('go-own-rooms-for-create');
    },

    onCreateRoomAvatarInputChange(this: any, event: Event) {
      this.$emit('create-room-avatar-change', event);
    },

    onRoomAvatarInputChange(this: any, event: Event) {
      this.$emit('room-avatar-change', event);
    },

    onCreateRoom(this: any) {
      this.$emit('create-room');
    },

    onSaveRoom(this: any) {
      this.$emit('save-room');
    },

    onLeaveSelectedRoom(this: any) {
      this.$emit('leave-selected-room');
    },

    onKickRoomMember(this: any, member: any) {
      this.$emit('kick-room-member', member);
    },

    openMediaViewer(this: any, src: string, alt?: string) {
      this.$emit('media-open', src, alt);
    },
  },
};
