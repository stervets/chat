import {type PropType} from 'vue';
import type {Message} from '@/composables/types';

import ScriptableFallbackEmpty from '@/components/chat/message-scriptable/components/fallback-empty/index.vue';
import ScriptableFallbackUnknown from '@/components/chat/message-scriptable/components/fallback-unknown/index.vue';
import {buildScriptableMessageViewProps, getScriptableMessageView} from './registry';

export default {
  components: {
    ScriptableFallbackEmpty,
    ScriptableFallbackUnknown,
  },

  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
    viewModel: {
      type: Object as PropType<Record<string, any> | null>,
      default: null,
    },
    passiveEffects: {
      type: Boolean,
      default: false,
    },
    viewSource: {
      type: String,
      default: 'timeline',
    },
  },

  emits: [
    'action',
    'runtime-view-mounted',
    'runtime-view-unmounted',
  ],

  setup() {
    return {
      runtimeViewInstanceId: `view-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
  },

  computed: {
    resolvedScriptableView(this: any) {
      return getScriptableMessageView(this.viewModel?.kind);
    },

    resolvedScriptableViewProps(this: any) {
      return buildScriptableMessageViewProps(this.viewModel?.kind, this.viewModel || {}, {
        passiveEffects: !!this.passiveEffects,
      });
    },
  },

  watch: {
    'message.id'(this: any, nextIdRaw: unknown, prevIdRaw: unknown) {
      const nextId = Number(nextIdRaw || 0);
      const prevId = Number(prevIdRaw || 0);
      if (nextId === prevId) return;
      if (Number.isFinite(prevId) && prevId > 0) {
        this.emitRuntimeViewUnmounted(prevId);
      }
      this.emitRuntimeViewMounted(nextId);
    },
  },

  methods: {
    onAction(this: any, actionType: string, payload?: any) {
      this.$emit('action', this.message, actionType, payload);
    },

    emitRuntimeViewMounted(this: any, messageIdRaw?: unknown) {
      const messageId = Number(messageIdRaw || this.message?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.$emit('runtime-view-mounted', messageId, this.viewSource, this.runtimeViewInstanceId);
    },

    emitRuntimeViewUnmounted(this: any, messageIdRaw?: unknown) {
      const messageId = Number(messageIdRaw || this.message?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.$emit('runtime-view-unmounted', messageId, this.viewSource, this.runtimeViewInstanceId);
    },
  },

  mounted(this: any) {
    this.emitRuntimeViewMounted();
  },

  beforeUnmount(this: any) {
    this.emitRuntimeViewUnmounted();
  },
};
