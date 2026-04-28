import {nextTick, ref} from 'vue';

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

  setup() {
    return {
      localMessageInputEl: ref<HTMLTextAreaElement | null>(null),
      inputResizeHandler: ref<(() => void) | null>(null),
    };
  },

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

  watch: {
    messageText(this: any) {
      void nextTick(() => {
        this.resizeMessageInputHeight();
      });
    },

    canComposeInActiveDialog(this: any, nextValue: boolean) {
      if (!nextValue) return;
      void nextTick(() => {
        this.resizeMessageInputHeight();
      });
    },
  },

  mounted(this: any) {
    this.inputResizeHandler = () => {
      this.resizeMessageInputHeight();
    };
    if (this.inputResizeHandler) {
      window.addEventListener('resize', this.inputResizeHandler);
    }
    void nextTick(() => {
      this.resizeMessageInputHeight();
    });
  },

  beforeUnmount(this: any) {
    if (this.inputResizeHandler) {
      window.removeEventListener('resize', this.inputResizeHandler);
      this.inputResizeHandler = null;
    }
  },

  methods: {
    onMessageInputRef(this: any, el: HTMLTextAreaElement | null) {
      this.localMessageInputEl = el;
      this.$emit('page-ref', 'messageInputEl', el);
      this.resizeMessageInputHeight();
    },

    resizeMessageInputHeight(this: any) {
      const input = this.localMessageInputEl as HTMLTextAreaElement | null;
      if (!input) return;

      const viewportHeight = Math.max(0, Number(window.innerHeight || 0));
      const maxHeight = Math.max(44, Math.floor(viewportHeight * 0.4));
      input.style.height = 'auto';
      const naturalHeight = Math.max(44, Number(input.scrollHeight || 0));
      const nextHeight = Math.min(maxHeight, naturalHeight);
      input.style.height = `${nextHeight}px`;
      input.style.overflowY = naturalHeight > maxHeight ? 'auto' : 'hidden';
    },

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

    onInput(this: any) {
      this.resizeMessageInputHeight();
    },

    onGalleryInputChange(this: any, event: Event) {
      this.$emit('gallery-change', event);
    },

    onSend(this: any) {
      this.$emit('send');
    },
  },
};
