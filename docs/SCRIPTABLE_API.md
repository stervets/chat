# Scriptable API (MVP Contract)

## 1. Что такое scriptable entity

Поддерживаются два типа сущностей:

- `message`
- `room`

Обе работают через общий runtime manager + worker.

## 2. Модель данных

### Message

- `kind: text | system | scriptable`
- `script_id`
- `script_revision`
- `script_mode`
- `script_config_json`
- `script_state_json`

### Room

- `script_id`
- `script_revision`
- `script_mode`
- `script_config_json`
- `script_state_json`

`script_mode`: `client | client_server | client_runner`.

## 3. WS команды

### `scripts:create-message`

Создаёт scriptable message в комнате.

```json
["scripts:create-message", [roomId, {
  "scriptId": "demo:guess_word",
  "scriptRevision": 1,
  "config": {}
}], "frontend", "backend", "rid"]
```

Ответ:

```json
{"ok": true, "message": {...}}
```

### `scripts:action`

Отправляет shared-action для `client_server/client_runner`.

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

Возвращает scriptable entity комнаты.

```json
["scripts:room:get", [roomId], "frontend", "backend", "rid"]
```

## 4. WS событие состояния

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

Это источник persistent/shared state update для клиента.

## 5. Worker API для скрипта

`create(api)` получает:

- `getSnapshot()`
- `getConfig()`
- `getSharedState()`
- `getLocalState()`
- `setLocalState(next)`
- `setViewModel(next)`
- `requestSharedAction(actionType, payload?)`

## 6. Hooks (контракт)

Поддерживаемые hooks:

- `onInit()`
- `onEvent({source, type, payload})`
- `onDispose()`

Legacy hooks (`onUserAction/onSharedState/onHostEvent`) удалены и не поддерживаются.

## 7. Unified Runtime Event Contract

```ts
type ScriptRuntimeEvent = {
  source: 'ui' | 'room' | 'server' | 'system';
  type: string;
  payload?: any;
}
```

Примеры событий:

- `ui:action` (`source='ui'`)
- `chat_message` / `chat_message_updated` / `chat_message_deleted` (`source='room'`)
- `script_action` (`source='room'`, для room runtime после успешного `scripts:action`)
- `state:update` / `shared_action_error` (`source='server'`)
- `runtime:init`, `runtime:dispose`, `lifecycle:mount`, `lifecycle:unmount`, `system:ws_disconnected`, `system:ws_reconnected`, `system:session_expired` (`source='system'`)

## 8. Lifecycle contract

- `init`: создание runtime instance (`onInit`, `runtime:init`)
- `mount`: первый UI view этой сущности (`lifecycle:mount`)
- `update`: shared state change (`state:update`)
- `unmount`: последний UI view исчез (`lifecycle:unmount`)

## 9. State / Effects правила

- Shared state (`script_state_json`) — только данные.
- Local state — только клиентские данные runtime.
- Effects (звук/вибрация/одноразовые действия) не должны храниться в shared state.

Если у сущности два view (timeline + pinned), второй view может работать в `passiveEffects` и не запускать локальные side-effects.

## 10. Runtime identity и pinned

- Runtime identity фиксирован по entity id (`message:<id>`, `room:<id>`).
- Для pinned message второй runtime не создаётся.
- Повторные mount/unmount views не должны ломать local/shared state runtime.

## 11. Ограничения

- Не плодить runtime instance для одной сущности.
- Не смешивать effects со shared state.
- Не тащить бизнес-логику UI в backend reducer без необходимости.
- Обратная совместимость с legacy-hooks не поддерживается.
- В app room роль app-surface выполняет только pinned `scriptable` message.
