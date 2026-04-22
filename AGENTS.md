# AGENTS.md

## Проект
`MARX` — закрытый mobile-first чат (PWA) с:
- комнатами `group | direct | game | comment`;
- игровым модулем `King`;
- scriptable runtime (message-level и room-level).

Репа:
- `backend` — NestJS HTTP + WebSocket + Prisma/PostgreSQL.
- `frontend` — Nuxt 3 SPA (`ssr:false`), Vue 3, Element Plus, Tailwind, Less.
- `scripts` — smoke/e2e/stress + telegram pipeline.
  - `scripts/smoke-e2e.js`: отправка сообщения через кнопку `.send-btn` (чтобы не ловить конфликт с `Отправить тестовый push`).

## Ключевая модель данных
- `nodes`, `rooms`, `rooms_users`, `messages`, `message_reactions`, `sessions`, `push_subscriptions`.
- дерево существует только через `nodes.parent_id`.
- `nodes.type` на текущем шаге: `room | message`.
- `rooms.id = nodes.id` для room-node.
- `messages.id = nodes.id` для message-node.
- админ комнаты живёт в `nodes.created_by` room-ноды (в direct админа нет).
- `rooms.pinned_node_id -> nodes.id` (`ON DELETE SET NULL`).
- pinned сейчас всегда message-node, но хранится именно как `node id`.
- comment room — это child room-node под message-node (`rooms.kind = 'comment'`).
- pinned message может быть `text | system | scriptable` (ограничение только по принадлежности к той же комнате).
- `messages.sender_id` может быть `NULL` для анонимной отправки.
- `users.name` не уникален (поиск/выбор пользователя должен держать несколько совпадений).
- `users.push_disable_all_mentions` — отключение push от `@all`.
- scriptable/runtime поля живут в `nodes.client_script`, `nodes.server_script`, `nodes.data`.
- `messages.kind = text | system | scriptable`.
- в `nodes.data` лежат `scriptMode/scriptRevision/scriptConfig/scriptState` и `roomApp`.
  - для scriptable pinned действует правило `один runtime на message` (pinned может быть вторым view без второго worker).
  - runtime-контракт: identity по entity id (`message:<id>`, `room:<id>`), lifecycle `init -> mount/update -> unmount`.
  - эффекты (звук/вибрация/одноразовые side-effects) не хранить в shared state и не дублировать в passive view.
  - сервис в разработке: обратная совместимость scriptable runtime не поддерживается (legacy hooks удаляем, используем только актуальный контракт).

## Важное про WS
Пакет:
```ts
[com, args, senderId, recipientId, requestId?]
```
Ответ:
```ts
['[res]', [result], 'backend', 'frontend', requestId]
```

Исторически команды чата с префиксом `dialogs:*`, но работают с `roomId`.

Основные команды чата:
- `dialogs:general`, `dialogs:private`, `dialogs:directs`, `dialogs:messages`, `dialogs:delete`
- `chat:join`, `chat:send`, `chat:edit`, `chat:delete`, `chat:react`, `chat:pin`, `chat:unpin`
- `messages:discussion:get`, `messages:discussion:create`
- `rooms:create`, `rooms:app:configure`
- `scripts:create-message`, `scripts:action`, `scripts:room:get`

`chat:send` поддерживает опции в 3-м аргументе:
- `anonymous?: boolean`
- `silent?: boolean`

Основные events:
- `chat:message`, `chat:message-updated`, `chat:message-deleted`, `chat:pinned`
- `chat:room-updated`
- `chat:reactions`, `chat:reaction-notify`, `dialogs:deleted`, `users:updated`
- `scripts:state`, `games:*`

## Реальные entry points
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
- `frontend/src/pages/games/*`
- `frontend/src/pages/vpn/*`

## Конфиги
- `backend/config.json`
- `frontend/config.json`
- `scripts/config.json`
- `ops/caddy/*` (maintenance toggle include/скрипт)

`backend/config.json` обязателен. Без него backend не стартует.

## Прод (celesta)
- проект на сервере: `/home/lisov/projects/chat`
- PostgreSQL: rootless `podman` контейнер `marx-postgres` (`127.0.0.1:5432->5432/tcp`)
- backend service: `~/.config/systemd/user/marx-backend.service`
- backend service управление: `systemctl --user <start|stop|restart|status> marx-backend.service`

## Локальный запуск
```bash
yarn run backend:runner:dev
yarn run backend:dev
yarn run frontend:dev
```

## Prisma / БД
- Runtime backend использует `backend/config.json -> db.url`.
- Prisma CLI использует `DATABASE_URL`.
- Перед `prisma generate/push/migrate` убедись, что URL один и тот же.

## Временные отключения
- Скрипт комнаты `demo:room_meter` (`Счётчик комнаты`) временно отключён:
  - `backend/src/scriptable/registry.ts`
  - `backend/src/script-runner/registry.ts`
  - `backend/src/db.ts` (автопривязка к первой `group`-комнате)
  - `frontend/src/pages/chat/index.vue` (скрыт баннер `room-script-banner`)

## Если трогаешь подсистему
Auth/session:
- `backend/src/common/auth.ts`
- `backend/src/ws/chat/chat-auth.service.ts`
- `frontend/src/composables/ws-rpc.ts`

Rooms/direct/messages/reactions:
- `backend/src/common/rooms.ts`
- `backend/src/ws/chat/chat-dialogs.service.ts`
- `backend/src/ws/chat/chat-messages.service.ts`
- `backend/src/ws/chat/chat-reactions.service.ts`
- `frontend/src/pages/chat/modules/*`

Discussion rooms:
- post message и comment room связываются через `nodes.parent_id`
- обсуждение открывается как обычная room через `/chat?room=<discussionRoomId>`
- источник discussion для header подтягивается через `chat:join -> discussion`

Scriptable:
- `backend/src/scriptable/*`, `backend/src/script-runner/*`
- `frontend/src/scriptable/*`, `frontend/src/pages/chat/message-scriptable/*`
 - app room model:
   - `room` может быть обычной или `app room` (`nodes.data.roomApp.enabled=true`);
   - `pinned scriptable message` = app-surface;
   - `room script` = опциональный room-runtime оркестратор;
   - один runtime на `message:<id>`, pinned не создаёт второй worker.

Push/PWA:
- `backend/src/common/web-push.ts`, `backend/src/http/push.controller.ts`
- `frontend/src/composables/use-web-push.ts`, `frontend/src/composables/use-pwa-install.ts`
- `frontend/src/components/pwa-install-card/*`, `frontend/src/public/sw.js`

Deploy/Maintenance:
- `ops/caddy/*`
- `ops/maintenance/*`
- `docs/OPS_MAINTENANCE_MODE.md`

## Обязательные правила
- После **каждого изменения кода** обязательно актуализировать `AGENTS.md`.
- После **каждого выполнения задачи** обязательно визуально проверить результат через headless Chromium.
- Любая существенная правка поведения -> обновить docs (`docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md`) в той же задаче.
- Если меняешь auth/session — проверить WS auth и HTTP bearer endpoints.
- Если меняешь формат сообщений — проверить backend compile и frontend message-item.
- После фронтовых/WS правок прогонять минимум `yarn run test:login` или `yarn run smoke`.
- После локального запуска сервисов всегда останавливать процессы.
