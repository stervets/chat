export default {
  props: {
    activePinnedMessage: Object,
    canManagePinnedMessages: Boolean,
    getAuthorStyle: {type: Function, required: true},
    getRenderedMessageHtml: {type: Function, required: true},
    pinnedCollapsed: Boolean,
    pinnedPanelStyle: Object,
    shouldShowPinnedPanel: Boolean,
  },

  emits: [
    'body-click',
    'splitter-pointer-down',
    'toggle-collapsed',
    'unpin',
  ],

  methods: {
    togglePinnedCollapsed(this: any) {
      this.$emit('toggle-collapsed');
    },

    unpinActiveMessage(this: any) {
      this.$emit('unpin');
    },

    onPinnedBodyClick(this: any, event: MouseEvent) {
      this.$emit('body-click', event);
    },

    onPinnedSplitterPointerDown(this: any, event: PointerEvent) {
      this.$emit('splitter-pointer-down', event);
    },
  },
};
