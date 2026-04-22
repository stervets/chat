# AGENTS.md

## Что Это За Проект
`MARX` — закрытый чат для аварийной связи (mobile-first/PWA) с игровым модулем `King` и scriptable runtime для mini-app внутри чата.

Репа состоит из:
- `backend` — NestJS HTTP + WebSocket backend (auth/session, invites, rooms/messages/reactions, uploads, push, VPN, games).
- `frontend` — Nuxt 3 SPA, WS-RPC клиент + UI чата/инвайтов/VPN/игр.
- `scripts` — smoke/e2e/stress + Telegram news pipeline.

## Важное Про Текущее Состояние Кода
Текущая модель в коде уже на `rooms`:
- `Room.kind = group | direct | game`
- связь участников через `rooms_users`
- `messages.room_id`
- payload в основном на `roomId`, но для обратной совместимости часто дублируется `dialogId`.

Scriptable MVP:
- `Message.kind = text | system | scriptable`
- `messages.script_*` и `rooms.script_*` (id/revision/mode/config/state)
- modes: `client | client_server | client_runner`
- room-level runner процесс вынесен отдельно (`backend/src/script-runner/*`)

Важно: WS-команды для чата исторически всё ещё называются с префиксом `dialogs:*`, но работают с `roomId`.

## Стек
- `backend`: NestJS 11, `@nestjs/websockets`, `ws`, Prisma 6, PostgreSQL, `argon2`, `web-push`.
- `frontend`: Nuxt 3 (`ssr: false`), Vue 3, Element Plus, Tailwind, Less, `mitt`.
- Конфиг: JSON-файлы (`backend/config.json`, `frontend/config.json`, `scripts/config.json`).

## Реальные Точки Входа

### Backend
- `backend/src/main.ts`
  - старт Nest + WS adapter
  - CORS
  - `checkDb()`
  - cleanup на старте и раз в час
- `backend/src/app.module.ts`
  - `ChatGateway`, `ChatService`, `UploadsController`, `PushController`, `WebPushService`
- `backend/src/config.ts`
  - читает `backend/config.json`, без него падает
- `backend/src/db.ts`
  - Prisma datasource URL берётся из `backend/config.json`
  - runtime-правки nickname модели
  - runtime-индексы `rooms_kind_idx`, `rooms_users_user_idx`
  - runtime ensure `donation_badge_until`
  - runtime ensure scriptable columns/types + default room script
- `backend/src/scriptable/*`
  - backend shared-state layer (`scripts:create-message`, `scripts:action`, `scripts:room:get`)
  - file-based registry
  - runner ws-client
- `backend/src/script-runner/main.ts`
  - отдельный runner process для `client_runner` mode
- `backend/prisma/schema.prisma`
  - актуальный источник истины по схеме БД

### Frontend
- `frontend/nuxt.config.ts`
  - читает `frontend/config.json`
  - dev WS proxy
  - `ssr: false`
- `frontend/src/composables/classes/ws.ts`
  - низкоуровневый WS клиент
- `frontend/src/composables/ws-rpc.ts`
  - session restore/reconnect
  - auth/vpn/games RPC helpers
- `frontend/src/pages/chat/*`
  - основной чат
- `frontend/src/pages/games/*`
  - lobby и экран игровой сессии King
- `frontend/src/pages/vpn/*`
  - VPN provisioning/donation UI

## WS Протокол
Формат пакета:
```ts
[com, args, senderId, recipientId, requestId?]
```

Ответ:
```ts
['[res]', [result], 'backend', 'frontend', requestId]
```

## Реальные WS Команды

### Auth
- `auth:login`
- `auth:session`
- `auth:me`
- `auth:logout`
- `auth:updateProfile`
- `auth:changePassword`

### Users
- `users:list`

### Invites / VPN
- `invites:list`
- `invites:create`
- `invites:check`
- `invites:redeem`
- `public:vpnInfo`
- `public:vpnProvision`
- `public:vpnDonation`

### Chat / Rooms
- `dialogs:general`
- `dialogs:private`
- `dialogs:directs`
- `dialogs:messages`
- `dialogs:delete`
- `chat:join`
- `chat:send`
- `chat:edit`
- `chat:delete`
- `chat:react`
- `scripts:create-message`
- `scripts:action`
- `scripts:room:get`

### Games
- `games:solo:create`
- `games:session:get`
- `games:action`

## Серверные Events
- `chat:message`
- `chat:message-updated`
- `chat:message-deleted`
- `chat:reactions`
- `chat:reaction-notify`
- `dialogs:deleted`
- `users:updated`
- `games:session`
- `games:event`
- `games:state`
- `scripts:state`

Локальные фронтовые runtime-events:
- `ws:connected`
- `ws:disconnected`
- `ws:reconnected`
- `ws:session-expired`

## HTTP Endpoints
- `POST /upload/image`
- `GET /uploads/:name`
- `GET /push/public-key`
- `POST /push/subscribe`
- `POST /push/unsubscribe`
- `POST /push/test`

## Хранилища Состояния

### PostgreSQL
- `users`
- `invites`
- `rooms`
- `rooms_users`
- `messages`
- `message_reactions`
- `sessions`
- `push_subscriptions`
- `game_sessions`
- `game_session_players`
- scriptable поля в `rooms/messages`

### Filesystem
- uploads (`backend/config.json -> uploads.path`)

### Frontend localStorage
- `marx_session_token`
- chat preferences/notification flags

### In-memory backend
- WS subscriptions по `roomId` в `ChatGateway`

## Реальные Флоу

### Auth
1. `auth:login` или `invites:redeem` -> session token.
2. Токен сохраняется в `localStorage['marx_session_token']`.
3. При старте `auth:session(token)`.
4. HTTP upload/push используют тот же токен в `Authorization: Bearer <token>`.

### Rooms / Messages
- Общая комната: `dialogs:general` (type=`group`).
- Direct: `dialogs:private(userId)` (type=`direct`).
- История: `dialogs:messages(roomId, limit, beforeMessageId?)`.
- Подписка realtime: `chat:join(roomId)`.

### King
- Создание solo-сессии: `games:solo:create({moduleKey:'king'})`.
- Загрузка сессии: `games:session:get(sessionId)`.
- Ход: `games:action({sessionId, action})`.
- Чат игры использует те же `chat:*` команды в `room(kind='game')`.

## Message Formatting
`backend/src/common/message-format.ts`:
- `b(...)`, `u(...)`, `s(...)`, `h(...)`, `m(...)`
- `c#red(...)` / `c#61afef(...)`
- `@nickname`
- `[HH:MM:SS]` time reference
- ссылки + inline image preview
- `renderedPreviews` для `image/video/embed/youtube`

Форматирование компилируется на backend, фронт рендерит `renderedHtml`.

## Cleanup
`backend/src/jobs/cleanup.ts`:
- лимит истории: максимум `5000` сообщений на `room`
- удаление старых upload-файлов старше `30` дней
- запуск на старте + каждый час

## Конфиги

### Backend
`backend/config.json`:
- `host`, `port`, `wsPath`
- `wgAdminSocketPath`
- `inviteBaseUrl` (optional)
- `corsOrigins`
- `uploads.path`, `uploads.maxBytes`
- `vpn.donationPhone`, `vpn.donationBank`
- `push.vapidPublicKey`, `push.vapidPrivateKey`, `push.vapidSubject`
- `db.url`
- `scriptRunner.enabled`, `scriptRunner.url`, `scriptRunner.host`, `scriptRunner.port`, `scriptRunner.path`

### Frontend
`frontend/config.json`:
- `mode`, `apiUrl`, `wsPath`, `wsUrl?`, `publicUrl`
- `vpn.mtProxyDeepLink`, `vpn.mtProxyWebLink`
- `vpn.amneziaConfigUri`, `vpn.amneziaFiles.*`

### Scripts
`scripts/config.json`:
- playwright settings
- login smoke credentials
- smoke e2e endpoints/browser
- stress-seed params

## Prisma Подлянка
- runtime backend: `backend/config.json -> db.url`
- Prisma CLI schema: `env("DATABASE_URL")`

Перед `prisma generate/db push/migrate` проверь, что `DATABASE_URL` указывает на ту же БД.

## Локальный Запуск

Установка:
```bash
cd backend && yarn install
cd ../frontend && yarn install
cd .. && yarn install
```

Конфиги:
```bash
cp backend/config.example.json backend/config.json
cp frontend/config.example.json frontend/config.json
cp scripts/config.example.json scripts/config.json
```

Dev:
```bash
yarn run backend:runner:dev
yarn run backend:dev
yarn run frontend:dev
```

## Root Scripts
- `yarn run cli`
- `yarn run db:init`
- `yarn run invite:create`
- `yarn run user:bootstrap`
- `yarn run bots:seed`
- `yarn run message:send`
- `yarn run frontend:dev`
- `yarn run backend:dev`
- `yarn run backend:runner:dev`
- `yarn run telegram:login`
- `yarn run telegram:fetch`
- `yarn run telegram:hot`
- `yarn run telegram:rewrite`
- `yarn run telegram:digest`
- `yarn run smoke`
- `yarn run test:login`
- `yarn run stress:seed`

## Если Меняешь X — Смотри Сюда

### Auth / Session
- `backend/src/common/auth.ts`
- `backend/src/ws/chat/chat-auth.service.ts`
- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/pages/login/script.ts`

### Rooms / Directs / Routing
- `backend/src/common/rooms.ts`
- `backend/src/ws/chat/chat-dialogs.service.ts`
- `frontend/src/pages/chat/modules/methods-auth-dialogs-and-profile.ts`
- `frontend/src/pages/chat/modules/methods-runtime-and-routing.ts`
- `frontend/src/pages/direct/[username]/index.vue`

### Games / King
- `backend/src/ws/chat/chat-games.service.ts`
- `backend/src/modules-runtime/*`
- `backend/src/modules/king/*`
- `frontend/src/composables/king.ts`
- `frontend/src/pages/games/*`

### Messages / Formatting / Reactions
- `backend/src/common/message-format.ts`
- `backend/src/ws/chat/chat-context.ts`
- `backend/src/ws/chat/chat-messages.service.ts`
- `backend/src/ws/chat/chat-reactions.service.ts`
- `frontend/src/pages/chat/message-item/*`
- `frontend/src/pages/chat/modules/methods-message-body-and-reactions.ts`

### Scriptable Runtime
- `backend/src/scriptable/*`
- `backend/src/script-runner/*`
- `frontend/src/scriptable/*`
- `frontend/src/pages/chat/message-scriptable/*`
- `frontend/src/pages/chat/modules/methods-scriptable-runtime.ts`

### Uploads
- `backend/src/common/uploads.ts`
- `backend/src/http/uploads.controller.ts`
- `frontend/src/pages/chat/modules/methods-send-upload-and-runtime.ts`

### Push / PWA
- `backend/src/common/web-push.ts`
- `backend/src/http/push.controller.ts`
- `frontend/src/composables/use-web-push.ts`
- `frontend/src/public/sw.js`

### VPN
- `backend/src/common/wg-admin.client.ts`
- `backend/src/ws/chat/chat-invites.service.ts`
- `frontend/src/pages/vpn/script.ts`

### Startup / Infra
- `backend/src/config.ts`
- `frontend/nuxt.config.ts`
- `backend/config.json`
- `frontend/config.json`
- `scripts/config.json`
- `Caddyfile`

### DB / Init / Reset
- `backend/prisma/schema.prisma`
- `backend/src/db.ts`
- `backend/src/cli/db-init.ts`
- `backend/src/cli/db-reset.ts`

## Practical Checklist
- В слючае если задача связана с фронтендом или по прямой просьбе пользователя Codex обязан через headless Chromium проверить, что задача реально работает в UI, и только после этого считать задачу выполненной (или продолжать фиксить до зелёного результата). При проверке codex должен учитывать, что все сервисы обчно остановлены и тебе надо их поднять (фронтенд, бекенд). Пользователь lisov, пароль 123.
- Любая существенная правка кода -> обнови `AGENTS.md`.
- Если менял поведение, которое описано в `docs/*.md`, обнови docs в том же PR/коммите.
- Если меняешь backend пути `/ws`, `/push`, `/upload/image`, `/uploads/*` — проверь `Caddyfile`.
- Если меняешь форматирование сообщений — проверь и backend compile, и frontend message-item.
- Если меняешь auth/session — проверь и WS auth, и HTTP bearer endpoints.
- После фронтовых/WS правок прогоняй минимум:
  - `yarn run test:login`
  - или `yarn run smoke`
- После локального запуска сервисов не забудь их остановить.
