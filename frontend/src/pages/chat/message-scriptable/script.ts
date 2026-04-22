import {ref, type PropType} from 'vue';
import type {Message} from '@/composables/types';

export default {
  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
    viewModel: {
      type: Object as PropType<Record<string, any> | null>,
      default: null,
    },
  },

  emits: [
    'action',
  ],

  setup() {
    return {
      guessInput: ref(''),
      lastSoundTick: ref(0),
      audioEl: ref<HTMLAudioElement | null>(null),
    };
  },

  watch: {
    viewModel: {
      handler(this: any) {
        this.tryPlaySoundByTick();
      },
      deep: true,
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

    onAction(this: any, actionType: string, payload?: any) {
      this.$emit('action', this.message, actionType, payload);
    },

    onGuessInput(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      this.guessInput = String(target?.value || '');
    },

    onGuessSubmit(this: any) {
      const guess = String(this.guessInput || '').trim();
      if (!guess) return;
      this.onAction('submit_guess', {guess});
      this.guessInput = '';
    },

    ensureAudio(this: any, soundUrlRaw: unknown) {
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
      const viewModel = this.viewModel && typeof this.viewModel === 'object'
        ? this.viewModel
        : null;
      if (!viewModel || String(viewModel.kind || '') !== 'button_sound') return;

      const tick = Number(viewModel.soundTick || 0);
      if (!Number.isFinite(tick) || tick <= 0) return;
      if (tick === Number(this.lastSoundTick || 0)) return;
      this.lastSoundTick = tick;

      const audio = this.ensureAudio(viewModel.soundUrl);
      if (!audio) return;

      void audio.play().catch(() => null);
    },
  },

  beforeUnmount(this: any) {
    if (!this.audioEl) return;
    this.audioEl.pause();
    this.audioEl.currentTime = 0;
    this.audioEl = null;
  },
};
