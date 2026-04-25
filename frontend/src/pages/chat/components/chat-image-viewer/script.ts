export default {
  props: {
    imageViewerAlt: String,
    imageViewerSrc: String,
    imageViewerVisible: Boolean,
  },

  emits: [
    'backdrop-click',
    'close',
  ],

  methods: {
    onImageViewerBackdropClick(this: any, event: MouseEvent) {
      this.$emit('backdrop-click', event);
    },

    closeImageViewer(this: any) {
      this.$emit('close');
    },
  },
};
