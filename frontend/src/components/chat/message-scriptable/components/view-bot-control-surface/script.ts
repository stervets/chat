import type {PropType} from 'vue';

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    botLevelDraft: {
      type: Number,
      default: 50,
    },
  },

  emits: ['toggle', 'level-input', 'level-submit'],

  methods: {
    onLevelInput(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      const level = Number(target?.value || this.botLevelDraft || 0);
      this.$emit('level-input', level);
    },
  },
};
