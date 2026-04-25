# AGENTS.md

## Проект
`MARX` — закрытый mobile-first чат (PWA):
- комнаты `group | direct | game | comment`;
- игровой модуль `King`;
- scriptable/runtime для `message` и `room` сейчас временно выключен в активном chat flow.

Репа:
- `backend` — NestJS HTTP + WebSocket + Prisma/PostgreSQL;
- `frontend` — Nuxt 3 SPA (`ssr:false`), Vue 3, Tailwind, Less;
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
- `backend/src/ws/chat.domain.ts`
- `backend/src/ws/chat.commands.ts`
- `backend/src/ws/chat/chat-context*.ts`
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
- на мобильной вёрстке проверять длинные названия комнат в левом drawer (без горизонтального скролла/переполнения);
- для существенных изменений поведения обновлять `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md`;
- после фронтовых/WS правок прогонять `yarn run test:login` или `yarn run smoke`;
- после локального запуска сервисов — остановить процессы.
