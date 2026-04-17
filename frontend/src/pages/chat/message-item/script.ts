import {ref, type PropType} from 'vue';
import type {Message, MessageReaction} from '@/composables/types';

type LinkPreview = {
  key: string;
  type: 'image' | 'video' | 'embed' | 'youtube';
  src: string;
  href?: string;
};

export default {
  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
    messageIndex: {
      type: Number,
      required: true,
    },
    meId: {
      type: Number,
      default: null,
    },
    isMentionedForMe: {
      type: Boolean,
      required: true,
    },
    isBlinkTarget: {
      type: Boolean,
      required: true,
    },
    isEditing: {
      type: Boolean,
      required: true,
    },
    editingMessageText: {
      type: String,
      required: true,
    },
    messageActionPendingId: {
      type: Number,
      default: null,
    },
    canOpenDirect: {
      type: Boolean,
      required: true,
    },
    authorStyle: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
    formattedUsername: {
      type: String,
      required: true,
    },
    formattedTime: {
      type: String,
      required: true,
    },
    renderedHtml: {
      type: String,
      required: true,
    },
    extraPreviews: {
      type: Array as PropType<LinkPreview[]>,
      default: () => [],
    },
    reactionPickerOpen: {
      type: Boolean,
      required: true,
    },
    reactionPalette: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },

  emits: [
    'update:editing-message-text',
    'author-click',
    'direct-jump-click',
    'time-click',
    'start-edit',
    'delete-message',
    'edit-input-keydown',
    'save-edit',
    'cancel-edit',
    'message-body-click',
    'message-body-mousemove',
    'message-body-mouseleave',
    'toggle-reaction-picker',
    'reaction-select',
    'reaction-chip-click',
    'reaction-mouseenter',
    'reaction-mousemove',
    'reaction-mouseleave',
    'height-change',
  ],

  setup() {
    return {
      showHiddenText: ref(false),
      rootEl: ref<HTMLElement | null>(null),
      resizeObserver: null as ResizeObserver | null,
    };
  },

  methods: {
    isOwnMessage(this: any) {
      return Number(this.meId || 0) > 0 && Number(this.meId) === Number(this.message.authorId);
    },

    isMyReaction(this: any, reaction: MessageReaction) {
      const meId = Number(this.meId || 0);
      if (!meId || !Array.isArray(reaction?.users)) return false;
      return reaction.users.some((user) => Number(user.id) === meId);
    },

    onEditingInput(this: any, event: Event) {
      const target = event.target as HTMLTextAreaElement | null;
      this.$emit('update:editing-message-text', target?.value || '');
    },

    onAuthorClick(this: any) {
      this.$emit('author-click', this.message);
    },

    onDirectJumpClick(this: any) {
      this.$emit('direct-jump-click', this.message);
    },

    onTimeClick(this: any) {
      this.$emit('time-click', this.message);
    },

    onStartEdit(this: any) {
      this.$emit('start-edit', this.message);
    },

    onDeleteMessage(this: any) {
      this.$emit('delete-message', this.message);
    },

    onEditInputKeydown(this: any, event: KeyboardEvent) {
      this.$emit('edit-input-keydown', event, this.message);
    },

    onSaveEdit(this: any) {
      this.$emit('save-edit', this.message);
    },

    onCancelEdit(this: any) {
      this.$emit('cancel-edit');
    },

    onBodyClick(this: any, event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.message-spoiler')) {
        this.showHiddenText = true;
      }
      this.$emit('message-body-click', event, this.message, this.messageIndex);
    },

    onBodyMouseMove(this: any, event: MouseEvent) {
      this.$emit('message-body-mousemove', event);
    },

    onBodyMouseLeave(this: any) {
      this.$emit('message-body-mouseleave');
    },

    onToggleReactionPicker(this: any) {
      this.$emit('toggle-reaction-picker', this.message);
    },

    onReactionSelect(this: any, emoji: string) {
      this.$emit('reaction-select', this.message, emoji);
    },

    onReactionChipClick(this: any, reaction: MessageReaction) {
      this.$emit('reaction-chip-click', this.message, reaction);
    },

    onReactionMouseEnter(this: any, event: MouseEvent, reaction: MessageReaction) {
      this.$emit('reaction-mouseenter', event, reaction);
    },

    onReactionMouseMove(this: any, event: MouseEvent) {
      this.$emit('reaction-mousemove', event);
    },

    onReactionMouseLeave(this: any) {
      this.$emit('reaction-mouseleave');
    },

    emitHeight(this: any) {
      const root = this.rootEl as HTMLElement | null;
      if (!root) return;
      const styles = window.getComputedStyle(root);
      const marginTop = Number.parseFloat(styles.marginTop || '0') || 0;
      const marginBottom = Number.parseFloat(styles.marginBottom || '0') || 0;
      this.$emit('height-change', this.message.id, root.offsetHeight + marginTop + marginBottom);
    },
  },

  mounted(this: any) {
    this.emitHeight();
    if (typeof ResizeObserver === 'undefined') return;

    const root = this.rootEl as HTMLElement | null;
    if (!root) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.emitHeight();
    });
    this.resizeObserver.observe(root);
  },

  beforeUnmount(this: any) {
    if (!this.resizeObserver) return;
    this.resizeObserver.disconnect();
    this.resizeObserver = null;
  },
};
