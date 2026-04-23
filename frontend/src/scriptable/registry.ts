import {messageFartButtonV1} from './client-scripts/message-fart-button.v1';
import {messageGuessWordV1} from './client-scripts/message-guess-word.v1';
import {messagePollSurfaceV1} from './client-scripts/message-poll-surface.v1';
import {messageBotControlSurfaceV1} from './client-scripts/message-bot-control-surface.v1';
import {roomMeterV1} from './client-scripts/room-meter.v1';
import type {ScriptWorkerFactory} from './runtime/types';

const scripts: ScriptWorkerFactory[] = [
  messageFartButtonV1,
  messageGuessWordV1,
  messagePollSurfaceV1,
  messageBotControlSurfaceV1,
  roomMeterV1,
];

const scriptMap = new Map<string, ScriptWorkerFactory>();
scripts.forEach((script) => {
  scriptMap.set(`${script.nodeType}:${script.scriptId}`, script);
});

export function getClientScriptFactory(nodeTypeRaw: unknown, scriptIdRaw: unknown) {
  const nodeType = String(nodeTypeRaw || '').trim().toLowerCase();
  if (nodeType !== 'message' && nodeType !== 'room') return null;
  const scriptId = String(scriptIdRaw || '').trim().toLowerCase();
  if (!scriptId) return null;
  return scriptMap.get(`${nodeType}:${scriptId}`) || null;
}
