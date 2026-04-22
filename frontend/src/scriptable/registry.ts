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
  scriptMap.set(`${script.entityType}:${script.scriptId}:${script.revision}`, script);
});

export function getClientScriptFactory(entityTypeRaw: unknown, scriptIdRaw: unknown, revisionRaw: unknown) {
  const entityType = String(entityTypeRaw || '').trim().toLowerCase();
  if (entityType !== 'message' && entityType !== 'room') return null;
  const scriptId = String(scriptIdRaw || '').trim().toLowerCase();
  const revision = Number.parseInt(String(revisionRaw ?? ''), 10);
  if (!scriptId || !Number.isFinite(revision) || revision <= 0) return null;
  return scriptMap.get(`${entityType}:${scriptId}:${revision}`) || null;
}
