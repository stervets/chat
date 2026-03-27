import {ref, watch} from 'vue';
import {LAYOUTS} from '@/composables/const';

export default {
  async setup() {
    const layout = ref('main');
    const route = useRoute();

    watch(() => route.name, (name) => {
      const key = (name || 'index').toString().split('-')[0];
      layout.value = LAYOUTS[key] || 'main';
    }, {immediate: true});

    return {
      layout
    };
  }
}
