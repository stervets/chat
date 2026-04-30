import type {PropType} from 'vue';
import type {Message} from '@/composables/types';

export default {
  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
  },
};
