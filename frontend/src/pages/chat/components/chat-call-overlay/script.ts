import {Mic, MicOff, Phone, PhoneOff} from 'lucide-vue-next';

export default {
  components: {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
  },

  props: {
    callPhase: {
      type: String,
      default: 'idle',
    },
    callDirection: {
      type: String,
      default: null,
    },
    callPeerName: {
      type: String,
      default: 'Собеседник',
    },
    callPeerAvatarUrl: {
      type: String,
      default: '',
    },
    callMuted: Boolean,
    callDurationText: {
      type: String,
      default: '00:00',
    },
    callError: {
      type: String,
      default: '',
    },
    callRemoteStream: {
      type: Object,
      default: null,
    },
  },

  emits: [
    'answer',
    'reject',
    'hangup',
    'toggle-mute',
    'remote-audio-ready',
  ],

  computed: {
    peerFallback(this: any) {
      return String(this.callPeerName || '?').trim().charAt(0).toUpperCase() || '?';
    },

    subtitle(this: any) {
      if (this.callPhase === 'incoming') return 'Входящий звонок';
      if (this.callPhase === 'outgoing') return 'Звоним...';
      if (this.callPhase === 'connecting') return 'Соединяем...';
      if (this.callPhase === 'connected') return this.callDurationText;
      if (this.callPhase === 'ended') return this.callError || 'Звонок завершён';
      return '';
    },
  },

  mounted(this: any) {
    this.emitAudioRef();
  },

  updated(this: any) {
    this.emitAudioRef();
  },

  beforeUnmount(this: any) {
    this.$emit('remote-audio-ready', null);
  },

  methods: {
    emitAudioRef(this: any) {
      const el = this.$refs.remoteAudioEl || null;
      if (el && this.callRemoteStream && el.srcObject !== this.callRemoteStream) {
        el.srcObject = this.callRemoteStream;
      }
      this.$emit('remote-audio-ready', el);
    },
  },
};
