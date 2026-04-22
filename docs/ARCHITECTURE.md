# Architecture

## Состав

- `frontend/` — Nuxt 3 SPA (`ssr:false`), mobile-first UI чата.
- `backend/` — NestJS HTTP + WebSocket API.
- `backend/src/scriptable/*` и `backend/src/script-runner/*` — scriptable runtime и runner.
- `scripts/` — smoke/e2e/stress.

Конфиги:
- `backend/config.json`
- `frontend/config.json`

## Каноническая модель данных

В проекте больше нет отдельного graph-layer. Структура дерева живёт только в `nodes`.

### `nodes`

`nodes` — единственный источник истины про дерево:

- `id`
- `parent_id -> nodes.id`
- `type = room | message`
- `component`
- `client_script`
- `server_script`
- `data jsonb`
- `created_by`
- `created_at`

Правила:

- у любой контентной сущности ровно один канонический parent: `nodes.parent_id`;
- никаких `graph_nodes`, `graph_edges`, `discussion_room_id`, `parent_room_id`, `room_ref`, `space_id`, `folder_id`;
- дефолтная сортировка детей идёт по `id`.

### `rooms`

`rooms` хранит room-specific поля, но id общий с `nodes`:

- `rooms.id = nodes.id`
- `kind = group | direct | game | comment`
- `title`
- `pinned_node_id -> nodes.id`

Pinned у комнаты только один.

Админ комнаты определяется через `nodes.created_by` для room-node.

### `messages`

`messages` хранит только message-specific поля:

- `messages.id = nodes.id`
- `sender_id`
- `kind = text | system | scriptable`
- `raw_text`
- `rendered_html`
- `created_at`

Сообщение принадлежит комнате только через `nodes.parent_id`.
`messages.room_id` больше нет.

### Comment rooms

Комментарии к сообщению больше не оформляются специальным FK.

Модель такая:

- room-node `10`
- message-node `20`, где `nodes.parent_id = 10`
- comment room-node `30`, где `nodes.parent_id = 20` и `rooms.kind = 'comment'`

История внутри comment room обычная: под room-node лежат message-node.

## Runtime / scriptable

Скриптовая модель завязана на `nodes`, а не на отдельные `rooms.script_*` / `messages.script_*` колонки.

Используется простая схема:

- если у node есть `client_script`, у неё есть клиентский runtime;
- если у node есть `server_script`, у неё есть серверный runtime;
- конфиг и shared-state лежат в `nodes.data`.

Для текущего runtime pipeline в payload наружу по-прежнему вычисляются:

- `scriptId`
- `scriptRevision`
- `scriptMode`
- `scriptConfigJson`
- `scriptStateJson`

Но в БД отдельные legacy-колонки под это больше не используются.

App room тоже хранится в `nodes.data.roomApp`, а не в `rooms.app_*`.

## Backend

Ключевые entry points:

- `backend/src/main.ts`
- `backend/src/db.ts`
- `backend/src/ws/chat.gateway.ts`
- `backend/src/ws/chat/chat.service.ts`
- `backend/src/common/nodes.ts`
- `backend/src/common/rooms.ts`
- `backend/src/ws/chat/chat-dialogs.service.ts`
- `backend/src/ws/chat/chat-messages.service.ts`
- `backend/src/scriptable/service.ts`

Что важно:

- `graph:*` WS-команд больше нет;
- `db.ts` больше не пытается runtime-миграциями возвращать legacy-схему;
- cleanup удаляет лишние сообщения через `nodes`, а не через `messages.room_id`.

## Frontend

Ключевые entry points:

- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/pages/chat/*`
- `frontend/src/scriptable/runtime/*`
- `frontend/src/pages/games/*`
- `frontend/src/pages/vpn/*`

Что важно:

- встроенная spaces-навигация выпилена;
- отдельная `/spaces` страница выпилена;
- чат работает только с room/message payload и comment rooms.

## WebSocket

Пакет:

```ts
[com, args, senderId, recipientId, requestId?]
```

Ответ:

```ts
['[res]', [result], 'backend', 'frontend', requestId]
```

Основные команды:

- `dialogs:*`
- `chat:*`
- `messages:discussion:*`
- `rooms:create`
- `rooms:app:configure`
- `scripts:*`
- `games:*`

`graph:*` удалён.

## Миграция живой БД

Для живой старой схемы есть отдельный реальный скрипт:

- `backend/src/scripts/migrate-to-nodes.ts`
- запуск: `yarn --cwd backend run db:migrate:nodes`

Скрипт:

- делает remap `old_room_id -> new node id`;
- делает remap `old_message_id -> new node id`;
- переносит memberships, reactions, pinned, discussion rooms и game sessions;
- удаляет legacy graph/discussion/schema-хвосты после успешного переноса.
