# Scriptable Dev Flow

## Где лежат скрипты

### Backend

- registry: `backend/src/scriptable/registry.ts`
- shared-state/service: `backend/src/scriptable/service.ts`
- runner-client: `backend/src/scriptable/runner-client.ts`

### Runner

- runner entry: `backend/src/script-runner/main.ts`
- runner registry: `backend/src/script-runner/registry.ts`

### Frontend

- client scripts registry: `frontend/src/scriptable/registry.ts`
- client scripts: `frontend/src/scriptable/client-scripts/*`
- worker runtime: `frontend/src/scriptable/runtime/*`

## Как добавить новый script

1. Добавь backend definition в `backend/src/scriptable/registry.ts`.
2. Для `client_server` добавь `reduceAction`.
3. Для `client_runner` добавь обработчик в `backend/src/script-runner/registry.ts`.
4. Добавь frontend worker script в `frontend/src/scriptable/client-scripts/*`.
5. Зарегистрируй его в `frontend/src/scriptable/registry.ts`.

## Как регистрировать `scriptId` и `revision`

- `scriptId` фиксированный строковый ключ (например `demo:poll`).
- `revision` — integer.
- При несовместимой правке UI/runtime подними `revision`.
- Frontend сам перезапустит worker runtime при смене `revision`.

## Hot reload / rollout

В runtime:

- новый `revision` приходит в message/room payload или `scripts:state`;
- manager перезапускает worker для этой сущности;
- local state переносится в новый runtime (best effort).

## Как отлаживать client scripts

1. Запусти frontend `yarn run frontend:dev`.
2. В чате создай scriptable message через demo-кнопку.
3. Ошибки worker попадают в UI как `Script runtime error: ...`.
4. Проверяй `viewModel` в DOM (`.scriptable-*`).

## Как отлаживать runner scripts

1. Запусти runner: `yarn run backend:runner:dev`.
2. Запусти backend: `yarn run backend:dev`.
3. Проверяй room-level поведение в чате.
4. Останови runner и проверь деградацию (`runner_not_connected`).

## Как сделать shared-state message

1. Выбери mode `client_server`.
2. В backend definition добавь `reduceAction`.
3. В client script вызывай `requestSharedAction(...)`.
4. Обновление прилетит через `scripts:state`.

## Как сделать room script

1. Привяжи script к комнате (`rooms.script_*`).
2. Для сложной логики используй mode `client_runner`.
3. Обрабатывай `room_event` в runner script.
4. Отрисовку room-level UI делай через room worker view model.
