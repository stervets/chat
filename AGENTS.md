# AGENTS.md

## Проект
`MARX` — закрытый mobile-first чат (PWA) с:
- комнатами `group | direct | game`;
- игровым модулем `King`;
- scriptable runtime (message-level и room-level).

Репа:
- `backend` — NestJS HTTP + WebSocket + Prisma/PostgreSQL.
- `frontend` — Nuxt 3 SPA (`ssr:false`), Vue 3, Element Plus, Tailwind, Less.
- `scripts` — smoke/e2e/stress + telegram pipeline.

## Ключевая модель данных
- `rooms`, `rooms_users`, `messages`, `message_reactions`, `sessions`, `push_subscriptions`.
- админ комнаты: `rooms.created_by` (только для non-direct, в direct админа нет).
- `rooms.pinned_message_id -> messages.id` (`ON DELETE SET NULL`).
- `users.push_disable_all_mentions` — отключение push от `@all`.
- scriptable поля:
  - `messages.script_*`, `rooms.script_*`;
  - `messages.kind = text | system | scriptable`.

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
- `scripts:create-message`, `scripts:action`, `scripts:room:get`

Основные events:
- `chat:message`, `chat:message-updated`, `chat:message-deleted`, `chat:pinned`
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
- `Caddyfile`
- `ops/caddy/*` (maintenance toggle include/скрипт)

`backend/config.json` обязателен. Без него backend не стартует.

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

Scriptable:
- `backend/src/scriptable/*`, `backend/src/script-runner/*`
- `frontend/src/scriptable/*`, `frontend/src/pages/chat/message-scriptable/*`

Push/PWA:
- `backend/src/common/web-push.ts`, `backend/src/http/push.controller.ts`
- `frontend/src/composables/use-web-push.ts`, `frontend/src/composables/use-pwa-install.ts`
- `frontend/src/components/pwa-install-card/*`, `frontend/src/public/sw.js`

Deploy/Maintenance:
- `Caddyfile`
- `ops/caddy/*`
- `ops/maintenance/*`
- `docs/OPS_MAINTENANCE_MODE.md`

## Обязательные правила
- После **каждого изменения кода** обязательно актуализировать `AGENTS.md`.
- После **каждого выполнения задачи** обязательно визуально проверить результат через headless Chromium.
- Любая существенная правка поведения -> обновить docs (`docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md`) в той же задаче.
- Если меняешь `/ws`, `/push`, `/upload/image`, `/uploads/*` — проверить `Caddyfile`.
- Если меняешь auth/session — проверить WS auth и HTTP bearer endpoints.
- Если меняешь формат сообщений — проверить backend compile и frontend message-item.
- После фронтовых/WS правок прогонять минимум `yarn run test:login` или `yarn run smoke`.
- После локального запуска сервисов всегда останавливать процессы.
