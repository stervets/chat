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
    passiveEffects: {
      type: Boolean,
      default: false,
    },
    viewSource: {
      type: String,
      default: 'timeline',
    },
  },

  emits: [
    'action',
    'runtime-view-mounted',
    'runtime-view-unmounted',
  ],

  setup() {
    return {
      guessInput: ref(''),
      botLevelDraft: ref(50),
      lastSoundTick: ref(0),
      audioEl: ref<HTMLAudioElement | null>(null),
      runtimeViewInstanceId: `view-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
    'viewModel.level'(this: any, levelRaw: unknown) {
      const level = Number(levelRaw);
      if (!Number.isFinite(level)) return;
      this.botLevelDraft = Math.max(0, Math.min(100, Math.round(level)));
    },
    'message.id'(this: any, nextIdRaw: unknown, prevIdRaw: unknown) {
      const nextId = Number(nextIdRaw || 0);
      const prevId = Number(prevIdRaw || 0);
      if (nextId === prevId) return;
      if (Number.isFinite(prevId) && prevId > 0) {
        this.emitRuntimeViewUnmounted(prevId);
      }
      this.emitRuntimeViewMounted(nextId);
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

    onPollVote(this: any, optionIndexRaw: unknown) {
      const optionIndex = Number(optionIndexRaw);
      if (!Number.isFinite(optionIndex) || optionIndex < 0) return;
      this.onAction('vote_option', {optionIndex});
    },

    onBotToggle(this: any, enabledRaw: unknown) {
      this.onAction('toggle_enabled', {enabled: !!enabledRaw});
    },

    onBotLevelInput(this: any, event: Event) {
      const target = event.target as HTMLInputElement | null;
      const level = Number(target?.value || this.botLevelDraft || 0);
      this.botLevelDraft = Math.max(0, Math.min(100, Math.round(level)));
    },

    onBotLevelSubmit(this: any) {
      const level = Math.max(0, Math.min(100, Math.round(Number(this.botLevelDraft || 0))));
      this.onAction('set_level', {level});
    },

    stopAudioPlayback(this: any) {
      if (!this.audioEl) return;
      this.audioEl.pause();
      this.audioEl.currentTime = 0;
    },

    emitRuntimeViewMounted(this: any, messageIdRaw?: unknown) {
      const messageId = Number(messageIdRaw || this.message?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.$emit('runtime-view-mounted', messageId, this.viewSource, this.runtimeViewInstanceId);
    },

    emitRuntimeViewUnmounted(this: any, messageIdRaw?: unknown) {
      const messageId = Number(messageIdRaw || this.message?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.$emit('runtime-view-unmounted', messageId, this.viewSource, this.runtimeViewInstanceId);
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
      if (this.passiveEffects) return;

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

  mounted(this: any) {
    const initialLevel = Number(this.viewModel?.level || 50);
    if (Number.isFinite(initialLevel)) {
      this.botLevelDraft = Math.max(0, Math.min(100, Math.round(initialLevel)));
    }
    this.emitRuntimeViewMounted();
  },

  beforeUnmount(this: any) {
    this.emitRuntimeViewUnmounted();
    this.stopAudioPlayback();
    this.audioEl = null;
  },
};
