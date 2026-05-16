import type {PropType} from 'vue';

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },

  methods: {
    asJson(this: any, value: unknown) {
      try {
        return JSON.stringify(value || {}, null, 2);
      } catch {
        return '{}';
      }
    },
  },
};
