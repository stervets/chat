import mitt, {type Handler} from 'mitt';

const emitter = mitt();
const events: Record<string, Map<Function, Function>> = {};
export const responses: Record<string, any> = {};

export function emit(event: string, ...args: any[]) {
  emitter.emit(event, args);
  return true;
}

export function on(event: string, callback: Function, context: any = null) {
  if (typeof callback !== 'function') {
    console.error(`Event "${event}" has no callback!`);
    return;
  }

  const realCallback = function (args: any[]) {
    callback.call(context, ...args);
  };

  !events[event] && (events[event] = new Map());
  events[event].set(callback, realCallback);

  emitter.on(event, realCallback as Handler);
}

export function off(event: string, callback: Function) {
  if (!events[event]) return;
  if (!events[event].has(callback)) return;
  emitter.off(event, events[event].get(callback) as Handler);
  events[event].delete(callback);
}

export function once(event: string, callback: Function, context: any = null) {
  if (typeof callback !== 'function') {
    console.error(`Event ONCE "${event}" has no callback!`);
    return;
  }

  const onceCallback = (...attrs: any[]) => {
    callback.apply(context, attrs);
    off(event, onceCallback);
  };
  on(event, onceCallback, context);
}

export function transmit(event: string, value: any) {
  responses[event] = value;
}

export function stopTransmit(event: string) {
  delete responses[event];
}

export function receive(event: string, ...data: any[]) {
  return (typeof responses[event] === 'function' ? responses[event](...data) : responses[event]);
}
