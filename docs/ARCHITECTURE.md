# Architecture

## Состав

- `frontend/` — Nuxt 3 SPA (`ssr:false`), mobile-first UI чата.
- `backend/` — NestJS HTTP + WebSocket API.
- `backend/src/scriptable/*` и `backend/src/script-runner/*` — scriptable runtime и runner.
- `scripts/` — smoke/e2e/stress.

## Каноническая модель данных

Дерева вне `nodes` нет.

### `nodes`

`nodes` — единый источник истины:

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

- единственная структурная связь: `nodes.parent_id`;
- никаких `graph_nodes`, `graph_edges`, `space_id`, `folder_id`, `room_ref`, `discussion_room_id`.

### `rooms`

- `rooms.id = nodes.id`
- `kind = group | direct | game | comment`
- `title`
- `pinned_node_id -> nodes.id`

Pinned у комнаты один.

### `messages`

- `messages.id = nodes.id`
- `sender_id`
- `kind = text | system | scriptable`
- `raw_text`
- `rendered_html`
- `created_at`

Связь message -> room только через `nodes.parent_id`.

### Comment rooms

Comment room — обычная room-node под message-node:

- `rooms.kind = 'comment'`
- parent comment room = message-node

## Runtime / Scriptable

Runtime определяется только полями node:

- `client_script` -> клиентский runtime;
- `server_script` -> серверный runtime;
- `nodes.data` -> runtime данные (например `config`, `state`, `roomSurface`).

Наружный runtime snapshot:

```ts
{
  nodeType: 'message' | 'room',
  nodeId: number,
  roomId: number,
  clientScript: string | null,
  serverScript: string | null,
  data: Record<string, any>
}
```

`roomSurface` — derived модель UI-поверхности комнаты, не отдельный structural layer.

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
- `rooms:surface:configure`
- `scripts:*`
- `games:*`

## Миграция живой БД

`backend/src/scripts/migrate-to-nodes.ts`:

- remap `old_room_id -> new node id`;
- remap `old_message_id -> new node id`;
- перенос memberships/reactions/game sessions;
- финальная валидация counts + semantic invariants;
- удаление legacy graph/columns/types после успешного переноса.
