import {nextTick, ref, type PropType} from 'vue';
import type {Message, MessageReaction} from '@/composables/types';
import ScriptableMessage from '../message-scriptable/index.vue';

type LinkPreview = {
  key: string;
  type: 'image' | 'video' | 'embed' | 'youtube';
  src: string;
  href?: string;
};

export default {
  components: {
    ScriptableMessage,
  },

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
    isFreshMessage: {
      type: Boolean,
      default: false,
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
    canPinMessage: {
      type: Boolean,
      default: false,
    },
    isPinnedMessage: {
      type: Boolean,
      default: false,
    },
    canOpenDirect: {
      type: Boolean,
      required: true,
    },
    authorStyle: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
    showAuthorBadge: {
      type: Boolean,
      required: true,
    },
    authorBadgeOpacity: {
      type: Number,
      default: 1,
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
    scriptViewModel: {
      type: Object as PropType<Record<string, any> | null>,
      default: null,
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
    'script-action',
    'script-view-mounted',
    'script-view-unmounted',
    'toggle-pinned-message',
    'image-preview-click',
  ],

  setup() {
    return {
      showHiddenText: ref(false),
      rootEl: ref<HTMLElement | null>(null),
      reactionControlsEl: ref<HTMLElement | null>(null),
      reactionPickerEl: ref<HTMLElement | null>(null),
      reactionPickerDirection: ref<'up' | 'down'>('down'),
      reactionPickerMaxHeight: ref(220),
      reactionPopUntilByKey: ref<Record<string, number>>({}),
      reactionPopTimerByKey: ref<Record<string, number>>({}),
      resizeObserver: null as ResizeObserver | null,
    };
  },

  watch: {
    reactionPickerOpen(this: any, isOpen: boolean) {
      if (!isOpen) return;
      nextTick(() => {
        this.updateReactionPickerPlacement();
      });
    },
    'message.reactions': {
      handler(this: any, nextRaw: unknown, prevRaw: unknown) {
        if (!Array.isArray(prevRaw)) return;
        const nextReactions = Array.isArray(nextRaw) ? nextRaw : [];
        const prevReactions = Array.isArray(prevRaw) ? prevRaw : [];
        const prevCountByEmoji = new Map<string, number>();

        prevReactions.forEach((reaction: any) => {
          const emoji = String(reaction?.emoji || '');
          if (!emoji) return;
          const count = Array.isArray(reaction?.users) ? reaction.users.length : 0;
          prevCountByEmoji.set(emoji, count);
        });

        nextReactions.forEach((reaction: any) => {
          const emoji = String(reaction?.emoji || '');
          if (!emoji) return;
          const nextCount = Array.isArray(reaction?.users) ? reaction.users.length : 0;
          const prevCount = Number(prevCountByEmoji.get(emoji) || 0);
          if (nextCount <= 0) return;
          if (nextCount !== prevCount) {
            this.markReactionPop(emoji);
          }
        });
      },
      deep: true,
    },
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

    onTogglePinnedMessage(this: any) {
      this.$emit('toggle-pinned-message', this.message);
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
      if (this.message.kind === 'scriptable') return;
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

    onScriptAction(this: any, message: Message, actionType: string, payload?: any) {
      this.$emit('script-action', message, actionType, payload);
    },

    onScriptViewMounted(this: any, messageIdRaw: unknown, viewSourceRaw: unknown, viewInstanceIdRaw: unknown) {
      const messageId = Number(messageIdRaw || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.$emit('script-view-mounted', messageId, viewSourceRaw, viewInstanceIdRaw);
    },

    onScriptViewUnmounted(this: any, messageIdRaw: unknown, viewSourceRaw: unknown, viewInstanceIdRaw: unknown) {
      const messageId = Number(messageIdRaw || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.$emit('script-view-unmounted', messageId, viewSourceRaw, viewInstanceIdRaw);
    },

    onToggleReactionPicker(this: any) {
      this.$emit('toggle-reaction-picker', this.message);
      nextTick(() => {
        this.updateReactionPickerPlacement();
      });
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

    onImagePreviewClick(this: any, preview: LinkPreview) {
      this.$emit('image-preview-click', preview?.src || '');
    },

    markReactionPop(this: any, emojiRaw: unknown) {
      const emoji = String(emojiRaw || '');
      if (!emoji) return;
      const now = Date.now();
      const key = `${this.message.id}:${emoji}`;
      const until = now + 280;

      if (typeof window !== 'undefined') {
        const timerId = Number(this.reactionPopTimerByKey?.[key] || 0);
        if (timerId > 0) {
          clearTimeout(timerId);
        }
      }

      this.reactionPopUntilByKey = {
        ...this.reactionPopUntilByKey,
        [key]: until,
      };

      if (typeof window === 'undefined') return;
      const timeoutId = window.setTimeout(() => {
        const nextUntil = {...(this.reactionPopUntilByKey || {})};
        delete nextUntil[key];
        this.reactionPopUntilByKey = nextUntil;

        const nextTimers = {...(this.reactionPopTimerByKey || {})};
        delete nextTimers[key];
        this.reactionPopTimerByKey = nextTimers;
      }, 300);

      this.reactionPopTimerByKey = {
        ...this.reactionPopTimerByKey,
        [key]: timeoutId,
      };
    },

    isReactionPopping(this: any, reaction: MessageReaction) {
      const emoji = String(reaction?.emoji || '');
      if (!emoji) return false;
      const key = `${this.message.id}:${emoji}`;
      const until = Number(this.reactionPopUntilByKey?.[key] || 0);
      return until > Date.now();
    },

    emitHeight(this: any) {
      const root = this.rootEl as HTMLElement | null;
      if (!root) return;
      const styles = window.getComputedStyle(root);
      const marginTop = Number.parseFloat(styles.marginTop || '0') || 0;
      const marginBottom = Number.parseFloat(styles.marginBottom || '0') || 0;
      this.$emit('height-change', this.message.id, root.offsetHeight + marginTop + marginBottom);
    },

    updateReactionPickerPlacement(this: any) {
      if (!this.reactionPickerOpen) return;

      const controlsEl = this.reactionControlsEl as HTMLElement | null;
      const pickerEl = this.reactionPickerEl as HTMLElement | null;
      if (!controlsEl || !pickerEl) return;

      const scrollHostEl = controlsEl.closest('.chat-body') as HTMLElement | null;
      const controlsRect = controlsEl.getBoundingClientRect();
      const pickerRect = pickerEl.getBoundingClientRect();
      const boundaryRect = scrollHostEl
        ? scrollHostEl.getBoundingClientRect()
        : {
          top: 0,
          bottom: Number(window.innerHeight || 0),
        };
      const spaceBelow = boundaryRect.bottom - controlsRect.bottom - 10;
      const spaceAbove = controlsRect.top - boundaryRect.top - 10;
      const pickerNeed = pickerRect.height + 8;

      const preferUp = spaceBelow < pickerNeed && spaceAbove > spaceBelow;
      this.reactionPickerDirection = preferUp ? 'up' : 'down';

      const available = preferUp ? spaceAbove : spaceBelow;
      const clampedMaxHeight = Math.max(90, Math.min(320, Math.floor(available)));
      this.reactionPickerMaxHeight = clampedMaxHeight;
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
    if (typeof window !== 'undefined') {
      Object.values(this.reactionPopTimerByKey as Record<string, number>).forEach((timerId) => {
        clearTimeout(Number(timerId));
      });
    }
    this.reactionPopTimerByKey = {};
    this.reactionPopUntilByKey = {};
    if (!this.resizeObserver) return;
    this.resizeObserver.disconnect();
    this.resizeObserver = null;
  },
};
