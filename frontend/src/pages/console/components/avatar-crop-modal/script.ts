import {Save} from 'lucide-vue-next';

export default {
  components: {
    Save,
  },

  props: {
    avatarCropBusy: Boolean,
    avatarCropImageStyle: Object,
    avatarCropMaxScale: Number,
    avatarCropMinScale: Number,
    avatarCropScale: Number,
    avatarCropScalePercent: Number,
    avatarCropSourceUrl: {type: String, default: ''},
    avatarCropVisible: Boolean,
  },

  emits: [
    'close',
    'finalize',
    'overlay-click',
    'pointer-down',
    'scale-input',
  ],

  methods: {
    onAvatarCropOverlayClick(this: any) {
      this.$emit('overlay-click');
    },

    onAvatarCropPointerDown(this: any, event: PointerEvent) {
      this.$emit('pointer-down', event);
    },

    onAvatarCropScaleInput(this: any, event: Event) {
      this.$emit('scale-input', event);
    },

    closeAvatarCropper(this: any) {
      this.$emit('close');
    },

    finalizeAvatarCropAndUpload(this: any) {
      this.$emit('finalize');
    },
  },
};
