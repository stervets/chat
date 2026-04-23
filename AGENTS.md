# AGENTS.md

## Проект
`MARX` — закрытый mobile-first чат (PWA):
- комнаты `group | direct | game | comment`;
- игровой модуль `King`;
- scriptable runtime для `message` и `room`.

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
- shared state: `nodes.data.scriptState`;
- config: `nodes.data.scriptConfig`;
- room surface: `nodes.data.roomSurface`;
- один runtime на `message:<id>` или `room:<id>`; pinned не создаёт второй runtime.

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
- `dialogs:general`, `dialogs:private`, `dialogs:directs`, `dialogs:messages`, `dialogs:delete`
- `chat:join`, `chat:send`, `chat:edit`, `chat:delete`, `chat:react`, `chat:pin`, `chat:unpin`
- `messages:discussion:get`, `messages:discussion:create`
- `rooms:create`, `rooms:surface:configure`
- `scripts:create-message`, `scripts:action`, `scripts:room:get`

Основные events:
- `chat:message`, `chat:message-updated`, `chat:message-deleted`, `chat:pinned`
- `chat:room-updated`, `chat:reactions`, `chat:reaction-notify`
- `dialogs:deleted`, `users:updated`, `scripts:state`, `games:*`

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
- `frontend/src/pages/chat/*`
- `frontend/src/scriptable/*`
- `frontend/src/pages/games/*`

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

## Что проверять после правок
- после каждого изменения актуализировать `AGENTS.md`;
- после задачи — визуальная проверка через headless Chromium;
- для существенных изменений поведения обновлять `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md`;
- после фронтовых/WS правок прогонять `yarn run test:login` или `yarn run smoke`;
- после локального запуска сервисов — остановить процессы.
