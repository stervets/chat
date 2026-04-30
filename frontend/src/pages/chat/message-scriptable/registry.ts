import type {Component} from 'vue';

import ViewButtonSound from '@/components/chat/message-scriptable/components/view-button-sound/index.vue';
import ViewGuessWord from '@/components/chat/message-scriptable/components/view-guess-word/index.vue';
import ViewPollSurface from '@/components/chat/message-scriptable/components/view-poll-surface/index.vue';
import ViewBotControlSurface from '@/components/chat/message-scriptable/components/view-bot-control-surface/index.vue';

export const scriptableMessageViewRegistry: Record<string, Component> = Object.freeze({
  button_sound: ViewButtonSound,
  guess_word: ViewGuessWord,
  poll_surface: ViewPollSurface,
  bot_control_surface: ViewBotControlSurface,
});

export function getScriptableMessageView(kindRaw: unknown): Component | null {
  const kind = String(kindRaw || '').trim();
  if (!kind) return null;
  return scriptableMessageViewRegistry[kind] || null;
}
