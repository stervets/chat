import {ref, watch} from 'vue';
import {LAYOUTS} from '@/composables/const';
import {on, off} from '@/composables/event-bus';
import {resolveReservePromptAction} from '@/composables/ws-rpc';

export default {
  async setup() {
    const layout = ref('main');
    const reservePromptVisible = ref(false);
    const reservePromptId = ref('');
    const route = useRoute();

    watch(() => route.name, (name) => {
      const key = (name || 'index').toString().split('-')[0];
      layout.value = LAYOUTS[key] || 'main';
    }, {immediate: true});

    return {
      layout,
      reservePromptVisible,
      reservePromptId,
    };
  },

  methods: {
    onReservePromptShow(this: any, payload: {id?: string}) {
      const id = String(payload?.id || '').trim();
      if (!id) return;
      this.reservePromptId = id;
      this.reservePromptVisible = true;
    },

    closeReservePrompt(this: any, action: 'yes' | 'no' | 'never') {
      const id = String(this.reservePromptId || '').trim();
      this.reservePromptVisible = false;
      this.reservePromptId = '';
      if (!id) return;
      resolveReservePromptAction(id, action);
    },

    onReservePromptYes(this: any) {
      this.closeReservePrompt('yes');
    },

    onReservePromptNo(this: any) {
      this.closeReservePrompt('no');
    },

    onReservePromptNever(this: any) {
      this.closeReservePrompt('never');
    },
  },

  mounted(this: any) {
    on('reserve:prompt:show', this.onReservePromptShow);
  },

  beforeUnmount(this: any) {
    off('reserve:prompt:show', this.onReservePromptShow);
  },
}
