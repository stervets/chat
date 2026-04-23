# Scriptable API

## Модель

Scriptable runtime работает только через node:

- `nodes.client_script`
- `nodes.server_script`
- `nodes.data`

## WS команды

### `scripts:create-message`

Создаёт scriptable message-node.

```json
["scripts:create-message", [roomId, {
  "scriptId": "demo:guess_word",
  "config": {}
}], "frontend", "backend", "rid"]
```

### `scripts:action`

Shared action для message/room runtime.

```json
["scripts:action", [{
  "nodeType": "message",
  "nodeId": 123,
  "actionType": "submit_guess",
  "payload": {"guess": "marx"}
}], "frontend", "backend", "rid"]
```

Ответ:

```json
{"ok": true, "roomId": 1, "nodeType": "message", "nodeId": 123, "data": {}}
```

### `scripts:room:get`

Возвращает runtime snapshot комнаты:

```json
{"ok": true, "roomId": 1, "roomRuntime": {
  "nodeType": "room",
  "nodeId": 1,
  "roomId": 1,
  "clientScript": null,
  "serverScript": null,
  "data": {}
}}
```

## Event `scripts:state`

```json
{
  "roomId": 1,
  "nodeType": "message",
  "nodeId": 123,
  "clientScript": "demo:guess_word",
  "serverScript": "demo:guess_word",
  "data": {}
}
```

## Runtime contract

- identity: `message:<id>` / `room:<id>`
- lifecycle: `init -> mount -> update -> unmount`
- pinned view не создаёт второй runtime instance

Unified event envelope:

```ts
type ScriptRuntimeEvent = {
  source: 'ui' | 'room' | 'server' | 'system';
  type: string;
  payload?: any;
}
```

## Правила

- persistent runtime data хранится в `nodes.data`;
- если конкретному script нужно разделение, используй нейтральные ключи `nodes.data.config` и `nodes.data.state`;
- local state живёт только в worker;
- side-effects не дублируются между timeline/pinned views.
