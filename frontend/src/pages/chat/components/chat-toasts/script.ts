export default {
  props: {
    toasts: {type: Array, default: () => []},
    isToastClickable: {type: Function, required: true},
  },

  emits: [
    'close-toast',
    'toast-click',
  ],

  methods: {
    onToastClick(this: any, toast: any) {
      this.$emit('toast-click', toast);
    },

    removeToast(this: any, toastId: number) {
      this.$emit('close-toast', toastId);
    },
  },
};
