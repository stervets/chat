import {EventEmitter} from 'node:events';
import type {ChatContextMessagePayload} from '../ws/chat/chat-context.js';
import type {ScriptStateEventPayload} from './types.js';

export type ScriptableEvents = {
  'scripts:state': ScriptStateEventPayload;
  'scripts:message': ChatContextMessagePayload;
};

type EventName = keyof ScriptableEvents;

class ScriptableEventBus {
  private readonly emitter = new EventEmitter();

  on<K extends EventName>(event: K, handler: (payload: ScriptableEvents[K]) => void) {
    this.emitter.on(event, handler as (...args: any[]) => void);
    return () => {
      this.emitter.off(event, handler as (...args: any[]) => void);
    };
  }

  emit<K extends EventName>(event: K, payload: ScriptableEvents[K]) {
    this.emitter.emit(event, payload);
  }
}

export const scriptableEvents = new ScriptableEventBus();
