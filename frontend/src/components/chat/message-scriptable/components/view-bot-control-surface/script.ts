import {ref, type PropType} from 'vue';

function clampLevel(levelRaw: unknown) {
  const level = Number(levelRaw);
  if (!Number.isFinite(level)) return 50;
  return Math.max(0, Math.min(100, Math.round(level)));
}

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },

  emits: ['action'],

  setup() {
    return {
      levelDraft: ref(50),
    };
  },

  watch: {
    'viewModel.level'(this: any, levelRaw: unknown) {
      this.levelDraft = clampLevel(levelRaw);
    },
  },

  methods: {
    toggleEnabled(this: any, enabled: boolean) {
      this.$emit('action', 'toggle_enabled', {enabled: !!enabled});
    },

    onLevelInput(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.levelDraft = clampLevel(target?.value ?? this.levelDraft);
    },

    submitLevel(this: any) {
      this.$emit('action', 'set_level', {level: clampLevel(this.levelDraft)});
    },
  },

  mounted(this: any) {
    this.levelDraft = clampLevel(this.viewModel?.level);
  },
};
