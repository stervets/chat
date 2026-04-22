# Scriptable API

## 1. Scriptable entity

Поддерживаются:

- `message`
- `room`

## 2. Хранение

Scriptable runtime больше не хранится в отдельных `script_*` колонках таблиц `rooms/messages`.

Каноническое хранение теперь такое:

- `nodes.client_script`
- `nodes.server_script`
- `nodes.data`

В `nodes.data` лежат:

- `scriptMode`
- `scriptRevision`
- `scriptConfig`
- `scriptState`

Для app room туда же живёт `nodes.data.roomApp`.

## 3. WS команды

### `scripts:create-message`

Создаёт scriptable message-node в комнате.

```json
["scripts:create-message", [roomId, {
  "scriptId": "demo:guess_word",
  "scriptRevision": 1,
  "config": {}
}], "frontend", "backend", "rid"]
```

### `scripts:action`

Shared-action для runtime:

```json
["scripts:action", [{
  "entityType": "message",
  "entityId": 123,
  "actionType": "submit_guess",
  "payload": {"guess": "marx"}
}], "frontend", "backend", "rid"]
```

### `scripts:room:get`

Возвращает room runtime snapshot.

## 4. `scripts:state`

```json
{
  "roomId": 1,
  "entityType": "message",
  "entityId": 123,
  "scriptId": "demo:guess_word",
  "scriptRevision": 1,
  "scriptMode": "client_server",
  "scriptStateJson": {}
}
```

## 5. Runtime contract

- identity: `message:<id>` / `room:<id>`
- lifecycle: `init -> mount -> update -> unmount`
- второй runtime для pinned message не создаётся

Unified runtime event:

```ts
type ScriptRuntimeEvent = {
  source: 'ui' | 'room' | 'server' | 'system';
  type: string;
  payload?: any;
}
```

## 6. Rules

- shared state хранится только в `nodes.data.scriptState`;
- local state живёт только в worker;
- эффекты не хранятся в shared state;
- legacy hooks не поддерживаются.
