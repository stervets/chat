# Nodes Migration

## Что делает миграция

Скрипт:

```bash
yarn --cwd backend run db:migrate:nodes
```

переносит legacy-схему на новую модель с канонической таблицей `nodes`.

## Remap id

Старые `rooms.id` и `messages.id` жили в разных autoincrement-пространствах, поэтому скрипт делает полный remap:

- `old_room_id -> new node id`
- `old_message_id -> new node id`

Внутри транзакции создаются временные mapping tables:

- `room_id_map`
- `message_id_map`

Потом через них перестраиваются все связи.

## Что переносится

- `rooms` -> room-nodes + новая таблица `rooms`
- `messages` -> message-nodes + новая таблица `messages`
- `rooms_users`
- `message_reactions`
- `game_sessions`
- `game_session_players`
- pinned (`rooms.pinned_message_id -> rooms.pinned_node_id`)
- discussion rooms (`messages.discussion_room_id` -> child room-node с `rooms.kind='comment'`)
- script/app данные -> `nodes.client_script`, `nodes.server_script`, `nodes.data`

## Что удаляется

- `graph_nodes`
- `graph_edges`
- old `rooms/messages` legacy tables
- старые enum types для graph/script/app/room/message legacy-модели

## Как запускать

1. Остановить backend и script runner.
2. Убедиться, что `backend/config.json -> db.url` и `DATABASE_URL` смотрят в одну и ту же БД.
3. Сделать backup PostgreSQL.
4. Запустить:

```bash
yarn --cwd backend run db:migrate:nodes
```

5. После успешного завершения сгенерировать Prisma client при необходимости:

```bash
yarn --cwd backend prisma generate
```

## Fail-fast / повторный запуск

- скрипт проверяет, не применялась ли миграция раньше;
- при успешном завершении создаётся `nodes_migration_meta`;
- повторный запуск на уже мигрированной БД просто завершается без действий.
