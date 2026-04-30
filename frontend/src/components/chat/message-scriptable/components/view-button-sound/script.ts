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
    emitAction(this: any, actionType: string, payload?: any) {
      this.$emit('action', actionType, payload);
    },
  },
};
