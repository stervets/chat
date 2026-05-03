import {ref, type PropType} from 'vue';

export default {
  props: {
    viewModel: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    passiveEffects: {
      type: Boolean,
      default: false,
    },
  },

  emits: ['action'],

  setup() {
    return {
      lastSoundTick: ref(0),
      audioEl: ref<HTMLAudioElement | null>(null),
    };
  },

  watch: {
    'viewModel.soundTick'(this: any) {
      this.tryPlaySoundByTick();
    },

    passiveEffects(this: any, value: boolean) {
      if (value) {
        this.stopAudioPlayback();
        return;
      }
      this.tryPlaySoundByTick();
    },
  },

  methods: {
    emitAction(this: any, actionType: string, payload?: any) {
      this.$emit('action', actionType, payload);
    },

    stopAudioPlayback(this: any) {
      if (!this.audioEl) return;
      this.audioEl.pause();
      this.audioEl.currentTime = 0;
    },

    ensureAudio(this: any, soundUrlRaw: unknown) {
      if (typeof Audio === 'undefined') return null;

      const soundUrl = String(soundUrlRaw || '').trim();
      if (!soundUrl) return null;
      if (this.audioEl && this.audioEl.src.endsWith(soundUrl)) {
        return this.audioEl as HTMLAudioElement;
      }

      const audio = new Audio(soundUrl);
      audio.preload = 'auto';
      audio.volume = 0.35;
      this.audioEl = audio;
      return audio;
    },

    tryPlaySoundByTick(this: any) {
      if (this.passiveEffects) return;

      const tick = Number(this.viewModel?.soundTick || 0);
      if (!Number.isFinite(tick) || tick <= 0) return;
      if (tick === Number(this.lastSoundTick || 0)) return;
      this.lastSoundTick = tick;

      const audio = this.ensureAudio(this.viewModel?.soundUrl);
      if (!audio) return;

      void audio.play().catch(() => null);
    },
  },

  beforeUnmount(this: any) {
    this.stopAudioPlayback();
    this.audioEl = null;
  },
};
