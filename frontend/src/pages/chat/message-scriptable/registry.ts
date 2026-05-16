import type {Component} from 'vue';

import ViewButtonSound from '@/components/chat/message-scriptable/components/view-button-sound/index.vue';
import ViewGuessWord from '@/components/chat/message-scriptable/components/view-guess-word/index.vue';
import ViewPollSurface from '@/components/chat/message-scriptable/components/view-poll-surface/index.vue';
import ViewBotControlSurface from '@/components/chat/message-scriptable/components/view-bot-control-surface/index.vue';

type ScriptableMessageViewContext = {
  passiveEffects: boolean;
};

type ScriptableMessageViewDefinition = {
  kind: string;
  component: Component;
  buildProps?: (context: ScriptableMessageViewContext) => Record<string, any>;
};

export const scriptableMessageViewDefinitions: readonly ScriptableMessageViewDefinition[] = Object.freeze([
  {
    kind: 'button_sound',
    component: ViewButtonSound,
    buildProps: ({passiveEffects}) => ({passiveEffects}),
  },
  {
    kind: 'guess_word',
    component: ViewGuessWord,
  },
  {
    kind: 'poll_surface',
    component: ViewPollSurface,
  },
  {
    kind: 'bot_control_surface',
    component: ViewBotControlSurface,
  },
]);

export const scriptableMessageViewRegistry: Readonly<Record<string, ScriptableMessageViewDefinition>> = Object.freeze(
  scriptableMessageViewDefinitions.reduce<Record<string, ScriptableMessageViewDefinition>>((registry, definition) => {
    registry[definition.kind] = definition;
    return registry;
  }, {}),
);

export function getScriptableMessageViewDefinition(kindRaw: unknown): ScriptableMessageViewDefinition | null {
  const kind = String(kindRaw || '').trim();
  if (!kind) return null;
  return scriptableMessageViewRegistry[kind] || null;
}

export function getScriptableMessageView(kindRaw: unknown): Component | null {
  return getScriptableMessageViewDefinition(kindRaw)?.component || null;
}

export function buildScriptableMessageViewProps(
  kindRaw: unknown,
  viewModel: Record<string, any>,
  context: ScriptableMessageViewContext,
): Record<string, any> {
  const definition = getScriptableMessageViewDefinition(kindRaw);
  return {
    viewModel,
    ...(definition?.buildProps?.(context) || {}),
  };
}
