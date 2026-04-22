# Scriptable API (MVP)

## 1. Модель данных

### Message

- `kind: MessageKind` (`text | system | scriptable`)
- `script_id: varchar(128) | null`
- `script_revision: int`
- `script_mode: ScriptExecutionMode | null`
- `script_config_json: jsonb`
- `script_state_json: jsonb`

### Room

- `script_id: varchar(128) | null`
- `script_revision: int`
- `script_mode: ScriptExecutionMode | null`
- `script_config_json: jsonb`
- `script_state_json: jsonb`

### Enums

- `MessageKind`
- `ScriptExecutionMode` (`client | client_server | client_runner`)

## 2. WS команды

### `scripts:create-message`

Формат:

```json
["scripts:create-message", [roomId, payload], "frontend", "backend", "rid"]
```

`payload`:

```json
{
  "scriptId": "demo:fart_button",
  "scriptRevision": 1,
  "config": {}
}
```

Ответ:

```json
{"ok": true, "message": {...}}
```

### `scripts:action`

Формат:

```json
["scripts:action", [{
  "entityType": "message",
  "entityId": 123,
  "actionType": "submit_guess",
  "payload": {"guess": "marx"}
}], "frontend", "backend", "rid"]
```

Ответ:

```json
{"ok": true, "roomId": 1, "entityType": "message", "entityId": 123, "state": {...}}
```

### `scripts:room:get`

Формат:

```json
["scripts:room:get", [roomId], "frontend", "backend", "rid"]
```

Ответ:

```json
{"ok": true, "roomId": 1, "roomScript": {...} | null}
```

## 3. WS события

### `scripts:state`

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

Событие отправляется всем участникам комнаты.

## 4. Client worker API (для script-кода)

Скрипт в worker получает API:

- `getSnapshot()`
- `getConfig()`
- `getSharedState()`
- `getLocalState()`
- `setLocalState(next)`
- `setViewModel(next)`
- `requestSharedAction(actionType, payload?)`

Lifecycle hooks скрипта:

- `onInit()`
- `onUserAction({actionType, payload})`
- `onSharedState(state)`
- `onHostEvent({eventType, payload})`
- `onDispose()`

## 5. Backend shared-state API

Backend-редьюсер (для `client_server`) принимает:

- `entityType/entityId/roomId`
- `actionType/payload`
- `actor`
- текущие `config/state`

И возвращает:

- `nextState`
- optional `sideEffects` (в MVP: `system_message`).

## 6. Runner API

Transport: внутренний WS backend <-> runner.

Request:

- `type: room_event | entity_action`
- payload содержит:
  - entity metadata (`entityType/entityId/roomId/scriptId/revision/mode`)
  - `scriptConfigJson`
  - `scriptStateJson`
  - event/action data.

Response:

- `ok`
- `state`
- optional `sideEffects`.

## 7. Message payload (frontend)

`Message` дополнен полями:

- `kind`
- `scriptId`
- `scriptRevision`
- `scriptMode`
- `scriptConfigJson`
- `scriptStateJson`
