# Architecture

## Состав

- `frontend/` — Nuxt 3 SPA (`ssr:false`), mobile-first UI чата.
- `backend/` — NestJS HTTP + WebSocket API.
- `backend/src/scriptable/*` и `backend/src/script-runner/*` — scriptable runtime и runner.
- `scripts/` — smoke/e2e/stress.

Текущий UI layout:
- `/chat` — чат с левой навигацией `Директы | Комнаты`;
- `/console` — общий экран с вкладками пользователя, комнат, VPN и инвайтов;
- `/user/[nickname]`, `/vpn`, `/invites` — лёгкие redirect-роуты в `/console`.

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
- `visibility = public | private`
- `comments_enabled = boolean`
- `avatar_path`
- `post_only_by_admin = boolean`

Pinned у комнаты один.

Правила доступа:
- `direct` и `comment` доступны только участникам;
- `private group/game` доступны только участникам;
- `public group/game` видны авторизованным пользователям и могут быть joined через `room:join`.
- выход из room делается через `room:leave` (для `group/game`);
- если `post_only_by_admin=true`, писать в room может только `nodes.created_by` этой комнаты.

Удаление/очистка:
- `room:delete` для `group/game/comment` удаляет room по текущим правам.
- `room:delete` для `direct` не удаляет room/node: очищает историю сообщений для обоих участников и сбрасывает `pinned_node_id`.
- после direct clear рассылается realtime event `room:messages:cleared`.
- direct остаётся в списках; чтобы убрать direct из навигации, используется pin/unpin/hide-поток, а не `room:delete`.

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
- создание нового comment room зависит от `sourceRoom.comments_enabled`;
- уже существующие comment room не ломаются, даже если комментарии потом выключили.

### User profile / avatars / contacts

`users` дополнительно используют:
- `info`
- `avatar_path`

Avatar хранится как upload-path (`/uploads/<safe-name>`), не как полный origin.
У room действует то же правило: в БД лежит только path (`/uploads/...` или безопасный статика-path вроде `/marx_logo.png`).

Контакты:
- `users_contacts(owner_id, contact_id, created_at)`
- это простой user-to-user список без ролей и ACL-комбинаторики.

### Invite room bindings

Invite больше не означает “пихнуть нового пользователя во все group room”.

Используется таблица:
- `invites_rooms(invite_id, room_id)`

`invites:create` семантика:
- `invites:create({})` сохраняет legacy fallback и может привязать fallback/default room.
- `invites:create({roomIds:[]})` создаёт invite без `invites_rooms`.
- `invites:create({roomIds:[id...]})` привязывает только доступные creator'у `group` комнаты.

Redeem добавляет пользователя в комнаты из invite; если `invites_rooms` пусто у legacy invite, fallback идёт в default group room.
Дополнительно redeem добавляет пользователя в системную комнату `Новости MARX`/`MARX` (если существует).
`Общий чат` не добавляется через explicit empty invite (`roomIds:[]`).
`room:group:get-default` может создать default room, но membership в `room_users` не создаёт.
Если redeem делает уже авторизованный пользователь, создаётся не новый user, а только новые memberships в room из invite.
После успешного redeem invite удаляется.

## Console / навигация

- `/console` держит user/rooms/vpn/invites в одном месте.
- user tab: просмотр/редактирование профиля, локальные настройки уведомлений, web-push, пароль.
- rooms tab: список room, где профиль-владелец является admin; там же room edit/create и список участников с online-dot.
- pin active direct/room в `/chat`:
  - direct pin = `contacts:add` (закреплённые директы);
  - room pin = `room:join` (закреплённые комнаты в навигации).
- unpin вынесен в `/console`: для direct это `contacts:remove`, для room — `room:leave`.
- direct web-push-клик всегда ведёт в канонический маршрут `/chat?room=<directRoomId>&focusMessage=<messageId>` (без промежуточных redirect через `/direct/*`).
- admin комнаты может исключить участника через `room:members:remove`; исключённый участник получает event `room:deleted`.
- vpn tab: только PWA install + VPN provisioning.
- invites tab: создание invite с выбором доступных room.
- клиент хранит последний chat/direct маршрут в localStorage и использует его как точку возврата для кнопок `Назад` и после relogin.

## Runtime / Scriptable

Runtime определяется только полями node:

- `client_script` -> клиентский runtime;
- `server_script` -> серверный runtime;
- `nodes.data` -> runtime данные (например `config`, `state`, `roomSurface`).

Но прямо сейчас runtime в основном chat flow временно выключен:
- новые scriptable messages не создаются;
- `runtime:action` не исполняется;
- `room:surface:set` не включает room app;
- `room:runtime:get` отдаёт `null`;
- старые scriptable messages остаются в истории как fallback content без активного runtime.

## Media / previews

- HTTP upload общий: `POST /upload/media`.
- image/video лежат в тех же `/uploads/*`.
- image лимит по умолчанию ~20MB (`uploads.maxBytes`), video — `uploads.videoMaxBytes` (fallback 50MB).
- image на клиенте пережимаются до `max 1024x1024` (с сохранением пропорций).
- avatar upload в `/console` идёт через crop-оверлей (круглая маска), сервер получает уже обрезанный `1024x1024`.
- Rutube ссылки компилируются в iframe embed preview.

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

- `room:group:get-default`
- `room:list`
- `room:direct:get-or-create`
- `room:get`
- `room:create`
- `room:join`
- `room:leave`
- `room:members:list`
- `room:members:add`
- `room:members:remove`
- `room:settings:update`
- `room:delete`
- `room:surface:set`
- `room:pin:set`
- `room:pin:clear`
- `room:runtime:get`
- `message:list`
- `message:create`
- `message:update`
- `message:delete`
- `message:reaction:set`
- `message:comment-room:get`
- `message:comment-room:create`
- `runtime:action`
- `user:get`
- `contacts:list`
- `contacts:add`
- `contacts:remove`
- `invites:available-rooms`
- `game:session:create-solo`
- `game:session:get`
- `game:session:action`

Основные events:

- `message:created`
- `message:updated`
- `message:deleted`
- `message:reactions:updated`
- `message:reaction:notify`
- `room:updated`
- `room:deleted`
- `room:messages:cleared`
- `room:pin:updated`
- `user:updated`
- `game:session:updated`
- `game:event`
- `game:state:updated`

## Миграция живой БД

`backend/src/scripts/migrate-to-nodes.ts`:

- remap `old_room_id -> new node id`;
- remap `old_message_id -> new node id`;
- перенос memberships/reactions/game sessions;
- финальная валидация counts + semantic invariants;
- удаление legacy graph/columns/types после успешного переноса.

## Direct WebRTC voice calls

1-1 звонки реализованы поверх direct-комнат:

- WebSocket остаётся signaling-каналом (`call:*` commands/events).
- Media-трафик не проходит через backend: браузеры соединяются через `RTCPeerConnection`.
- Backend держит состояние звонков в памяти (`ChatCallsService`): `ringing`, `accepted`, `ended`.
- На одном backend instance нельзя начать второй активный звонок для тех же участников.
- При disconnect последнего WS-сокета пользователя его активные звонки завершаются с reason `disconnect`.
- Ringing-звонки автоматически истекают по `config.webrtc.callRingTimeoutMs`.

PWA поведение:

- открытая вкладка получает `call:incoming` по WS и показывает in-app overlay;
- закрытая/спящая PWA получает Web Push `incoming_call`, service worker открывает `/chat?room=<roomId>&callId=<callId>`;
- ответ/отклонение из notification action обрабатываются через route query `callAction=answer|reject` после открытия приложения.

При горизонтальном масштабировании backend call-state нужно вынести из in-memory `Map` в Redis/Postgres + pub/sub, иначе два участника одного звонка могут попасть на разные instances.
