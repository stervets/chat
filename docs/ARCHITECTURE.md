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
- `src/ws/chat/chat-graph.service.ts` — graph-layer контейнеров (`space/folder/room_ref`).
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
- discussion rooms: `messages.discussion_room_id -> rooms.id` (`ON DELETE SET NULL`)
- админ комнаты: `rooms.created_by` (только для non-direct; `direct` без админа)
- закреп комнаты: `rooms.pinned_message_id -> messages.id` (`ON DELETE SET NULL`)
- app-room режим: `rooms.app_enabled`, `rooms.app_type`, `rooms.app_config_json`
- push-настройка пользователя: `users.push_disable_all_mentions`
- `users.name` не уникален (поиск пользователей работает по `name` и `nickname` с несколькими совпадениями)

Graph слой контейнеров:
- `graph_nodes` (`kind = space | folder | room_ref`)
- `graph_edges` (`parent_node_id -> child_node_id`, `edge_type = child`, `sort_order`)
- `room_ref` хранит ссылку на существующую `rooms.id` через `target_type='room'` + `target_id`
- на текущем шаге разрешены только `target_type = none | room`
- `message-ref` отсутствует и не поддерживается
- graph не хранит сообщения и не заменяет `rooms/messages`

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
- снимаются legacy unique-constraints/индексы с `users.name` и создаётся обычный индекс `users_name_idx`;
- добавляется `users.donation_badge_until`, если нет;
- добавляются `users.push_disable_all_mentions` и `rooms.pinned_message_id` (+ FK/index), если нет;
- создаются runtime индексы `rooms_kind_idx`, `rooms_users_user_idx`.

### Cleanup

`src/jobs/cleanup.ts`:
- хранит максимум `5000` сообщений на комнату;
- закреплённое сообщение (`rooms.pinned_message_id`) не удаляется лимитом;
- удаляет старые upload-файлы старше `30` дней.

`messagesTtlDays` в рабочем backend больше не используется.

## Frontend

Ключевые файлы:
- `nuxt.config.ts` — runtime config, dev proxy для WS, `ssr: false`.
- `src/composables/classes/ws.ts` — WS клиент с request/response по пакетам.
- `src/composables/ws-rpc.ts` — reconnect + session restore + RPC-helpers.
- `src/pages/chat/*` — чат UI.
- `src/pages/chat/modules/methods-spaces-navigation.ts` — встроенная spaces-навигация в drawer чата.
- `src/pages/spaces/*` — полный экран graph-контейнеров (управление space/folder/room_ref).
- `src/pages/chat/modules/methods-message-body-and-reactions.ts` — time-reference jump, pinned state, image overlay.
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
- room pinned message (пин/анпин, realtime event `chat:pinned`, отдельная pinned-панель над лентой);
  - закреп только для админа non-direct комнаты;
  - в direct закреп отключён;
  - можно закреплять `text | system | scriptable` сообщения (только из той же комнаты);
  - pinned-панель можно свернуть локально, состояние хранится в `localStorage`;
  - размер pinned-панели регулируется drag-разделителем (`Element Plus ElDivider`) и сохраняется в `localStorage`;
- анонимная отправка: `chat:send(..., {anonymous:true})` создаёт сообщение с `sender_id = NULL`.
- mention-резолв: `@nickname` + fallback `@Name` (без NLP, с предсказуемым matching);
- image preview открывается во fullscreen overlay в текущем окне (без новой вкладки);
- PWA install card поддерживает Telegram in-app fallback hint;
- King solo mode (1 человек + 3 бота) в `room(kind='game')`;
- Scriptable runtime:
  - message-level mini-apps,
  - room-level script behavior,
  - worker runtime на клиенте,
  - shared-state и runner режимы;
  - при одновременном показе message в ленте и в pinned используется один runtime instance на `message.id` (без второго worker и без дубля локальных side-effects).
- app room model:
  - обычная комната: `app_enabled=false`, обычный чат;
  - app room: `app_enabled=true`, `pinned scriptable message` выступает как app-surface;
  - `room script` остаётся опциональным оркестратором комнаты;
  - backend и frontend получают единый `roomApp` payload в `dialogs:*`/`chat:join`.
- graph room navigation model:
  - `space/folder` дают иерархию контейнеров;
  - `room_ref` открывает обычную комнату через тот же chat route-flow (`/chat?room=<roomId>`);
  - при переходе из space в room прокидывается контекст `space/node` (`/chat?room=<id>&space=<spaceId>&node=<nodeId>`) для UX-навигации;
  - в основном chat UI есть встроенный вход в spaces (секция `Пространства` в левом drawer) и кнопка возврата в space в header комнаты;
  - существующая навигация `/chat` (general) и `/direct/:username` не ломается.
- discussion room model:
  - у сообщения может быть отдельная room обсуждения (`messages.discussion_room_id`);
  - discussion room остаётся обычной `room` и открывается тем же route-flow `/chat?room=<id>`;
  - кнопка `Комментарии` в `message-item` создаёт discussion room при первом открытии и переиспользует её дальше;
  - header discussion room показывает `Комментарии` и кнопку `К посту`;
  - если исходный message удалён, discussion room остаётся, а UI помечает состояние `исходный пост удалён`.
- VPN provisioning через `wg-admin` unix socket;
- Telegram news pipeline в `scripts/telegram-news`.

## Scriptable Runtime Layer

- identity:
  - `message` runtime key = `message:<id>`
  - `room` runtime key = `room:<id>`
- lifecycle:
  - `init` (создание worker/runtime)
  - `mount` (первый UI view для entity)
  - `update` (shared-state update)
  - `unmount` (последний UI view ушёл)
- unified event envelope:
  - `{source: 'ui'|'room'|'server'|'system', type, payload}`
- state:
  - shared/persistent state (`script_state_json`) синхронизируется через `scripts:state`
  - local state живёт в worker и не шарится между клиентами
- effects:
  - эффекты (звук/вибрация/одноразовые side-effects) не являются state
  - для второго рендера того же message (pinned) используется `passiveEffects`, чтобы не дублировать эффекты
- app-room связь:
  - `scripts:action` после успешного применения прокидывается в room runtime как `script_action` (через существующий room-event pipeline, без отдельного bus);
  - изменение app-room метаданных летит realtime-событием `chat:room-updated`.

## Источник истины

Если docs расходятся с кодом, верить:
1. `backend/prisma/schema.prisma`
2. `backend/src/ws/**/*`
3. `frontend/src/composables/types.ts`
4. `frontend/src/pages/**/*`
