# Scriptable Dev Flow

## Где лежит runtime

- node runtime живёт только в `nodes.client_script`, `nodes.server_script`, `nodes.data`;
- message runtime создаётся в `backend/src/scriptable/service.ts`;
- backend registry: `backend/src/scriptable/registry.ts`;
- runner registry: `backend/src/script-runner/registry.ts`;
- frontend runtime registry: `frontend/src/scriptable/registry.ts`;
- frontend message-view registry: `frontend/src/pages/chat/message-scriptable/registry.ts`;
- frontend worker runtime: `frontend/src/scriptable/runtime/*`;
- client scripts: `frontend/src/scriptable/client-scripts/*`;
- UI-компоненты message scriptable: `frontend/src/components/chat/message-scriptable/components/*`.

## Как добавить новый script

1. Добавь definition в `backend/src/scriptable/registry.ts`.
2. Укажи `scriptId`, `nodeType`, `clientScript`, `serverScript`.
3. Если script обрабатывает action прямо в backend, добавь `reduceAction`.
4. Если script обрабатывает action в runner, добавь handler в `backend/src/script-runner/registry.ts`.
5. Если нужен frontend runtime, добавь client worker script в `frontend/src/scriptable/client-scripts/*` и зарегистрируй его в `frontend/src/scriptable/registry.ts`.
6. Если нужен message UI, создай отдельный компонент в `frontend/src/components/chat/message-scriptable/components/<view-kind>/`.
7. Зарегистрируй message UI в `frontend/src/pages/chat/message-scriptable/registry.ts` (`kind -> component`, optional `buildProps`). Родительский `message-scriptable/index.vue` при этом не трогается.

## Как устроен runtime snapshot

Runner и frontend worker работают с одним и тем же простым payload:

```ts
{
  nodeType,
  nodeId,
  roomId,
  clientScript,
  serverScript,
  data
}
```

- `clientScript` включает client runtime;
- `serverScript` включает server runtime;
- `data` хранит весь runtime state и config;
- отдельного режима исполнения, версии runtime и выделенных protocol-полей под config/state в контракте нет.

## Runtime actions

- client script вызывает `requestRuntimeAction(actionType, payload)`;
- backend обрабатывает action либо через `reduceAction`, либо через runner;
- новое `data` сохраняется в `nodes.data`;
- обновление прилетает через `runtime:data:updated` и прокидывается в worker как `data:update`.

## Отладка

### Frontend

1. Запусти `yarn run frontend:dev`.
2. Создай scriptable message или room runtime.
3. Ошибки worker попадут в UI как `Script runtime error: ...`.
4. Проверяй `viewModel` и события `data:update`.

### Backend / runner

1. Запусти `yarn run backend:runner:dev`.
2. Запусти `yarn run backend:dev`.
3. Проверь action flow и room events.
4. Останови runner и убедись, что backend отвечает `runner_not_connected`.
