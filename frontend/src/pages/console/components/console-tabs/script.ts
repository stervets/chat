import {MessagesSquare, ShieldCheck, Ticket, UserRound} from 'lucide-vue-next';

export default {
  components: {
    MessagesSquare,
    ShieldCheck,
    Ticket,
    UserRound,
  },

  props: {
    activeTab: {type: String, default: 'user'},
    consoleUserTabLabel: {type: String, default: 'Профиль'},
  },

  emits: [
    'set-active-tab',
  ],

  methods: {
    setActiveTab(this: any, tab: string) {
      this.$emit('set-active-tab', tab);
    },
  },
};
