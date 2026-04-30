import type {PropType} from 'vue';

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },

  emits: ['vote'],

  methods: {
    onVote(this: any, optionIndexRaw: unknown) {
      const optionIndex = Number(optionIndexRaw);
      if (!Number.isFinite(optionIndex) || optionIndex < 0) return;
      this.$emit('vote', optionIndex);
    },
  },
};
