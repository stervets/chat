# Scriptable Chat Concept (MVP)

## Что внедрено

В проект добавлена модель `scriptable chat`, где:

- `message` может быть `text | system | scriptable`;
- `room` может иметь привязанный script/runtime;
- scriptable-сущности имеют `scriptId + scriptRevision + mode + config + shared state`.

Это встроено в текущий чат/rooms/WS flow без переписывания базовой архитектуры.

## Scriptable Message

`scriptable message` — это отдельный mini-app внутри bubble.

Поддерживается:

- локальный client-only интерактив (без backend-логики);
- shared-state message (`client_server`);
- реактивная перерисовка по state update;
- hot-restart runtime при смене `scriptRevision`.

## Scriptable Room

`scriptable room` — runtime на уровне комнаты.

Поддерживается:

- room-level shared state;
- room-level view model (в MVP — banner в чате);
- реакция на события комнаты (новые сообщения);
- отдельный mode `client_runner` с внешним runner-процессом.

## Execution Modes

- `client`
  - логика только в frontend worker;
  - backend хранит метаданные scriptable entity.

- `client_server`
  - UI/интерактив в worker;
  - action -> backend (`scripts:action`) -> shared state update -> broadcast.

- `client_runner`
  - UI/интерактив в worker;
  - сложная серверная логика в отдельном runner-процессе;
  - backend и runner общаются по внутреннему WS transport.

## Shared State

Для `client_server/client_runner` state хранится в БД:

- `messages.script_state_json`
- `rooms.script_state_json`

Обновления рассылаются WS-событием:

- `scripts:state`

## Runner

Runner вынесен в отдельный процесс:

- `backend/src/script-runner/main.ts`
- dev запуск: `yarn run backend:runner:dev`

Backend подключается к runner по `config.scriptRunner.url`.

Падение runner не валит backend: backend возвращает `runner_not_connected/runner_timeout` для runner-сценариев.

## Revision / Hot Reload

- Message/Room runtime в frontend привязан к ключу:
  - `entityType + entityId + scriptId + scriptRevision + mode`.
- При изменении `scriptRevision` runtime перезапускается автоматически.
- Перед рестартом сохраняется local state (если скрипт его использует).
