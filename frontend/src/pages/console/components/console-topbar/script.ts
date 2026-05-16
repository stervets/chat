import {ArrowLeft} from 'lucide-vue-next';

export default {
  components: {
    ArrowLeft,
  },

  emits: [
    'back',
  ],

  methods: {
    goBack(this: any) {
      this.$emit('back');
    },
  },
};
