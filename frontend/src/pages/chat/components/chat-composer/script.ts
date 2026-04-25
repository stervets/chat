export default {
  props: {
    canComposeInActiveDialog: Boolean,
    composerEmojis: {type: Function, required: true},
    composerNamedColors: {type: Function, required: true},
    composerToolsOpen: Boolean,
    messageText: {type: String, default: ''},
    pasteUploading: Boolean,
    sendAnonymous: Boolean,
  },

  emits: [
    'apply-format-wrapper',
    'apply-named-color-wrapper',
    'composer-emoji-click',
    'gallery-change',
    'keydown',
    'open-gallery-picker',
    'page-ref',
    'selection-capture',
    'send',
    'toggle-composer-tools',
    'update:messageText',
    'update:sendAnonymous',
    'paste',
  ],

  computed: {
    localMessageText: {
      get(this: any) {
        return this.messageText;
      },
      set(this: any, value: string) {
        this.$emit('update:messageText', value);
      },
    },

    localSendAnonymous: {
      get(this: any) {
        return this.sendAnonymous;
      },
      set(this: any, value: boolean) {
        this.$emit('update:sendAnonymous', value);
      },
    },
  },

  methods: {
    setPageRef(this: any, name: string, el: any) {
      this.$emit('page-ref', name, el);
    },

    toggleComposerTools(this: any) {
      this.$emit('toggle-composer-tools');
    },

    applyFormatWrapper(this: any, tag: string) {
      this.$emit('apply-format-wrapper', tag);
    },

    applyNamedColorWrapper(this: any, name: string) {
      this.$emit('apply-named-color-wrapper', name);
    },

    openGalleryPicker(this: any) {
      this.$emit('open-gallery-picker');
    },

    onComposerEmojiClick(this: any, emoji: string) {
      this.$emit('composer-emoji-click', emoji);
    },

    captureInputSelection(this: any, event: Event) {
      this.$emit('selection-capture', event);
    },

    onKeydown(this: any, event: KeyboardEvent) {
      this.$emit('keydown', event);
    },

    onInputPaste(this: any, event: ClipboardEvent) {
      this.$emit('paste', event);
    },

    onGalleryInputChange(this: any, event: Event) {
      this.$emit('gallery-change', event);
    },

    onSend(this: any) {
      this.$emit('send');
    },
  },
};
