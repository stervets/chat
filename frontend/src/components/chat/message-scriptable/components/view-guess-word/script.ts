import {ref, type PropType} from 'vue';

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
      guessInput: ref(''),
    };
  },

  methods: {
    onGuessInput(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.guessInput = String(target?.value || '');
    },

    submitGuess(this: any) {
      const guess = String(this.guessInput || '').trim();
      if (!guess) return;
      this.$emit('action', 'submit_guess', {guess});
      this.guessInput = '';
    },
  },
};
