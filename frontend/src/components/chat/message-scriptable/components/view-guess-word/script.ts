import type {PropType} from 'vue';

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    guessInput: {
      type: String,
      default: '',
    },
  },

  emits: ['guess-input', 'submit'],

  methods: {
    onGuessInput(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.$emit('guess-input', String(target?.value || ''));
    },
  },
};
