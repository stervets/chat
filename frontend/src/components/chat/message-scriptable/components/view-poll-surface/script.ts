import type {PropType} from 'vue';

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },

  emits: ['action'],

  methods: {
    vote(this: any, optionIndexRaw: unknown) {
      const optionIndex = Number(optionIndexRaw);
      if (!Number.isFinite(optionIndex) || optionIndex < 0) return;
      this.$emit('action', 'vote_option', {optionIndex});
    },
  },
};
