# Architecture

Проект состоит из двух приложений:
- `frontend/` — Nuxt 3 SPA (mobile-first).
- `backend/` — NestJS HTTP + WebSocket API.

Конфиг хранится в JSON:
- `frontend/config.json`
- `backend/config.json`
- `scripts/config.json`

## Backend

Ключевые файлы:
- `src/main.ts` — старт приложения, CORS, WS adapter, DB check, cleanup.
- `src/config.ts` — загрузка `backend/config.json`.
- `src/db.ts` — Prisma client + runtime DB checks/indexes.
- `src/ws/chat.gateway.ts` — WS транспорт и маршрутизация команд.
- `src/ws/chat/chat.service.ts` — фасад над auth/users/invites/dialogs/messages/reactions/games.
- `src/scriptable/*` — scriptable registry/shared-state/runner client.
- `src/script-runner/*` — отдельный runner процесс для `client_runner`.
- `src/http/uploads.controller.ts` — `POST /upload/image`, `GET /uploads/:name`.
- `src/http/push.controller.ts` — `/push/public-key|subscribe|unsubscribe|test`.
- `src/jobs/cleanup.ts` — cleanup при старте и раз в час.

### Модель данных

Чатовая модель уже на `rooms`:
- `rooms.kind = group | direct | game`
- участники: `rooms_users`
- сообщения: `messages.room_id`

Scriptable расширение:
- `messages.kind = text | system | scriptable`
- `messages.script_*` (`script_id/revision/mode/config/state`)
- `rooms.script_*` (`script_id/revision/mode/config/state`)

Игровая модель:
- `game_sessions`
- `game_session_players`

### Runtime гарантии

В `src/db.ts` на старте:
- проверяется подключение к PostgreSQL;
- нормализуется `users.nickname` + constraints;
- добавляется `users.donation_badge_until`, если нет;
- создаются runtime индексы `rooms_kind_idx`, `rooms_users_user_idx`.

### Cleanup

`src/jobs/cleanup.ts`:
- хранит максимум `5000` сообщений на комнату;
- удаляет старые upload-файлы старше `30` дней.

`messagesTtlDays` в рабочем backend больше не используется.

## Frontend

Ключевые файлы:
- `nuxt.config.ts` — runtime config, dev proxy для WS, `ssr: false`.
- `src/composables/classes/ws.ts` — WS клиент с request/response по пакетам.
- `src/composables/ws-rpc.ts` — reconnect + session restore + RPC-helpers.
- `src/pages/chat/*` — чат UI.
- `src/pages/direct/[username]/index.vue` — direct маршрут.
- `src/pages/games/*` — King lobby/session UI.
- `src/pages/vpn/*` — VPN UI.
- `src/composables/use-web-push.ts` + `src/public/sw.js` — web-push/PWA.

## Протокол

WS пакет:
```ts
[com, args, senderId, recipientId, requestId?]
```

Ответ:
```ts
['[res]', [result], 'backend', 'frontend', requestId]
```

Важно: команды чата исторически остались с префиксом `dialogs:*`,
но payload уже room-based (`roomId`, иногда с alias `dialogId`).

## Доменные фичи

- invite-only регистрация;
- session-token auth (не JWT, не cookie);
- group/direct чат, реакции, upload, push;
- King solo mode (1 человек + 3 бота) в `room(kind='game')`;
- Scriptable runtime:
  - message-level mini-apps,
  - room-level script behavior,
  - worker runtime на клиенте,
  - shared-state и runner режимы;
- VPN provisioning через `wg-admin` unix socket;
- Telegram news pipeline в `scripts/telegram-news`.

## Источник истины

Если docs расходятся с кодом, верить:
1. `backend/prisma/schema.prisma`
2. `backend/src/ws/**/*`
3. `frontend/src/composables/types.ts`
4. `frontend/src/pages/**/*`
