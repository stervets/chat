# AGENTS.md

## Проект
`MARX` — закрытый mobile-first чат (PWA):
- комнаты `group | direct | game | comment`;
- игровой модуль `King`;
- scriptable/runtime для `message` и `room` сейчас временно выключен в активном chat flow.

Репа:
- `backend` — NestJS HTTP + WebSocket + Prisma/PostgreSQL;
- `frontend` — Nuxt 3 SPA (`ssr:false`), Vue 3, Element Plus, Tailwind, Less;
- `scripts` — smoke/e2e/stress.

## Каноническая модель данных
- дерево только через `nodes.parent_id`;
- `nodes.type`: `room | message`;
- `rooms.id = nodes.id`;
- `messages.id = nodes.id`;
- `messages` не содержит `room_id`;
- comment room: child room-node под message-node (`rooms.kind='comment'`);
- pinned: `rooms.pinned_node_id -> nodes.id` (сейчас это message-node);
- админ room: `nodes.created_by` room-node (в direct админа нет);
- `messages.sender_id` может быть `NULL` (анонимная отправка).

Scriptable/runtime:
- runtime поля: `nodes.client_script`, `nodes.server_script`, `nodes.data`;
- runtime читает весь `nodes.data` целиком;
- если runtime делит данные на части, используй нейтральные ключи вроде `data.config` и `data.state`, без legacy-терминов;
- room surface: `nodes.data.roomSurface`;
- один runtime на `message:<id>` или `room:<id>`; pinned не создаёт второй runtime.
- важно: поля и старые файлы не выпилены, но `message:create(kind='scriptable')`, `runtime:action`, `room:surface:set` и активные runtime sync/update сейчас отключены.

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
- `room:group:get-default`, `room:list`, `room:direct:get-or-create`, `room:get`, `room:create`, `room:join`, `room:leave`, `room:delete`
- `room:members:list`, `room:members:add`, `room:members:remove`, `room:settings:update`
- `room:surface:set`, `room:pin:set`, `room:pin:clear`, `room:runtime:get`
- `message:list`, `message:create`, `message:update`, `message:delete`, `message:reaction:set`
- `message:comment-room:get`, `message:comment-room:create`
- `runtime:action`
- `game:session:create-solo`, `game:session:get`, `game:session:action`
- `user:get`
- `contacts:list`, `contacts:add`, `contacts:remove`
- `invites:available-rooms`, `invites:delete`

Основные events:
- `message:created`, `message:updated`, `message:deleted`
- `message:reactions:updated`, `message:reaction:notify`
- `room:updated`, `room:deleted`, `room:pin:updated`
- `user:updated`
- `game:session:updated`, `game:event`, `game:state:updated`

## Ключевые entry points
Backend:
- `backend/src/main.ts`
- `backend/src/app.module.ts`
- `backend/src/ws/chat.gateway.ts`
- `backend/src/ws/chat/chat.service.ts`
- `backend/src/db.ts`
- `backend/prisma/schema.prisma`

Frontend:
- `frontend/nuxt.config.ts`
- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/composables/last-chat.ts`
- `frontend/src/pages/chat/*`
- `frontend/src/pages/console/*`
- `frontend/src/pages/user/[nickname]/*`
- `frontend/src/pages/vpn/*`
- `frontend/src/scriptable/*`
- `frontend/src/pages/games/*`

Основные страницы:
- `/chat` — чат, директы, комнаты;
- `/direct/[nickname]` — direct route;
- `/console` — общий экран с вкладками пользователя, комнат, VPN и инвайтов;
- `/user/[nickname]` — лёгкий redirect в `/console?tab=user&nickname=...`;
- `/vpn` — redirect в `/console?tab=vpn`;
- `/invites` — redirect в `/console?tab=invites`.

## Конфиги
- `backend/config.json`
- `frontend/config.json`
- `scripts/config.json`

`backend/config.json` обязателен для старта backend.

## Локальный запуск
```bash
yarn run backend:runner:dev
yarn run backend:dev
yarn run frontend:dev
```

## Prisma / БД
- runtime backend использует `backend/config.json -> db.url`;
- Prisma CLI использует `DATABASE_URL`;
- перед `prisma generate/push/migrate` URL должны совпадать.

## Временно отключено
`demo:room_meter` временно выключен:
- `backend/src/scriptable/registry.ts`
- `backend/src/script-runner/registry.ts`
- `backend/src/db.ts` (автопривязка)
- `frontend/src/pages/chat/index.vue` (баннер room runtime скрыт)

Весь chat scriptable/runtime сейчас тоже спит:
- `message:create(kind='scriptable')` возвращает `scriptable_disabled`;
- `runtime:action` возвращает `scriptable_disabled`;
- `room:surface:set` возвращает `scriptable_disabled`;
- `room:runtime:get` отдаёт `roomRuntime:null`;
- старые `messages.kind='scriptable'` на клиенте рендерятся как обычный fallback без runtime.

## Что проверять после правок
- после каждого изменения актуализировать `AGENTS.md`;
- после задачи — визуальная проверка через headless Chromium;
- для существенных изменений поведения обновлять `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md`;
- после фронтовых/WS правок прогонять `yarn run test:login` или `yarn run smoke`;
- после локального запуска сервисов — остановить процессы.

## Актуализация 2026-04-23
- `getOrCreateGroupRoom/getOrCreateDirectRoom` защищены per-key in-memory lock без изменения схемы БД.
- cleanup upload-ссылок при `message:delete` и `room:delete` теперь собирает ссылки по всему subtree через `nodes`.
- `roomListDirect` берёт last message батчем (один SQL-запрос), без N+1.
- в compile-пайплайне сообщений добавлен tail-режим time-ref для новых сообщений без полного скана таймлайна; полный скан оставлен только там, где нужен точный nearest по индексу.
- добавлены black-box e2e тесты для login/session restore, group/direct send, comment room, upload cleanup при удалении source.
- для hot WS-команд введён единый ответ `{ok:true,data}` / `{ok:false,error}` на границе `chat.gateway.ts`, с нормализацией ошибок.
- для тех же WS-команд добавлены явные payload/data типы на boundary; старый формат на фронте поддержан локальным compat-адаптером в `frontend/src/composables/classes/ws.ts`.

## Актуализация 2026-04-24
- `Room` теперь хранит `visibility` (`public|private`) и `comments_enabled`.
- `Room` теперь также хранит `avatar_path` и `post_only_by_admin`; это нужно для каналов и room info.
- public group/game комнаты видны всем авторизованным, join делается через `room:join`; private/direct/comment — только участникам.
- invite теперь привязывается к конкретным комнатам через `invites_rooms`, а redeem больше не кидает пользователя во все group room подряд.
- использованный invite удаляется после redeem; вручную его можно снести через `invites:delete`.
- добавлены простые контакты `users_contacts` и WS-команды `contacts:list/add/remove`.
- у пользователя есть `info` и `avatar_path`; наружу уходит `avatarUrl` вида `/uploads/...`.
- аватары есть и у room; в `db:init` создаётся публичная room `MARX` с `/marx_logo.png`, комментариями и режимом `post_only_by_admin=true`.
- загрузка медиа идёт через `POST /upload/media`; картинки и видео лежат в тех же `/uploads/*`.
- лимит image upload поднят до ~20MB (`config.uploads.maxBytes`); client-side картинки и аватары пережимаются до `max 1024x1024` с сохранением пропорций.
- при смене avatar в `/console` есть crop-оверлей (drag/zoom + круглая маска), на сервер уходит уже обрезанный `1024x1024`.
- в сообщениях есть `commentCount`; кнопка комментариев живёт внизу справа у сообщения.
- Rutube ссылки (`rutube.ru/video/<id>`) компилируются в embed-preview.
- клиент хранит последний открытый `/chat` или `/direct/...` маршрут в `localStorage` и возвращается туда после relogin/возврата.
- pin message в direct запрещён (`room:pin:set|clear` для direct -> `forbidden`), но в header есть pin текущего dialog:
  - direct pin = `contacts:add` (попадает в закреплённые директы);
  - room pin = `room:join` (попадает в список комнат навигации).
- unpin вынесен в `/console`: для direct это `убрать из контактов`, для room это `Покинуть комнату` (`room:leave`).
- admin комнаты может исключать участников через `room:members:remove`, исключённый пользователь получает `room:deleted`.
- `invites:redeem` теперь работает и для уже авторизованного пользователя: invite добавляет доступы к новым room и затем удаляется.

## Актуализация 2026-04-25
- `invites:create` теперь различает `roomIds`:
  - `roomIds` не передан: остаётся legacy fallback-комната;
  - `roomIds: []`: создаётся invite без `invites_rooms`;
  - `roomIds` с id: строгая проверка доступности, иначе `invalid_rooms`.
- `room:group:get-default` больше не делает auto-join в `room_users`; даже если default room создаётся этим вызовом, membership не создаётся. В ответе есть `joined`.
- `/chat` на фронте выбирает дефолт через joined-комнаты, а не форсит `generalDialog`; при отсутствии joined-комнат автоджойна в `Общий чат` нет.
- `room:pin:set`/`room:pin:clear` разрешены только администратору комнаты (`userIsRoomAdmin`), direct по-прежнему запрещён.
- `room:delete` для direct теперь очищает переписку (и сбрасывает `pinnedNodeId`), но не удаляет саму room/node и участников.
- gateway для direct-clear не шлёт `room:deleted` и не закрывает room subscriptions.
- после direct-clear gateway рассылает `room:messages:cleared` всем участникам direct (включая инициатора).
- из invite-модели убраны `used_by/used_at` и relation `InviteUsedBy`; consume invite теперь single-use через атомарный delete в одной transaction.
