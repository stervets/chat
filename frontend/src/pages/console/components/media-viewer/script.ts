export default {
  props: {
    mediaViewerAlt: {type: String, default: ''},
    mediaViewerSrc: {type: String, default: ''},
    mediaViewerVisible: Boolean,
  },

  emits: [
    'close',
  ],

  methods: {
    closeMediaViewer(this: any) {
      this.$emit('close');
    },
  },
};
