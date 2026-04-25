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
- `messages.sender_id` для анонимной отправки указывает на системного пользователя `anonymous` (не `NULL`).

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

## Пользователи и уведомления
- `anonymous` не должен попадать в `user:list` и `contacts:list`, а также не должен добавляться в контакты;
- browser notifications в `/chat` не завязаны на флаг `webPushEnabled`: если событие не из текущего открытого диалога, нотификация может показываться даже при активной вкладке.

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

## Актуализация 2026-04-25
- анонимная отправка в direct считается "своей" на клиенте даже если `message:created` прилетает раньше RPC-ответа `message:create`;
- для этого pending-маркер анонимного сообщения ставится до отправки RPC и затем уточняется по `messageId` из ответа.
- backend анонимной отправки пишет `messages.sender_id` как `id` системного `anonymous`; при отсутствии такого пользователя backend создаёт его автоматически.
- логин `anonymous` доступен с паролем `123` (backend при необходимости принудительно обновляет hash этого пользователя).
- из header чата убран legacy fallback `Общий чат`: при отсутствии `activeDialog` заголовок теперь пустой, для group fallback теперь `Комната`;
- убран визуальный рывок заголовка по клику: для `.title-button` отключён `:active` transform/filter;
- заголовок group-уведомлений теперь берётся из реальной комнаты (`joined/public/general`) и больше не хардкодится строкой `Общий чат`.
- роутинг чата нормализует путь (`/chat` и `/chat/` считаются одинаковым route): `room` query больше не теряется при reload;
- вход на `/chat/` теперь обрабатывается как вход на `/chat`: применяется редирект в `last-chat` (если есть) иначе открывается первая доступная комната;
- `last-chat` теперь хранится в каноническом виде (убираются хвостовые `/` у path-части: `/chat/` -> `/chat`, `/direct/user/` -> `/direct/user`).
- в меню директов закреплённые контакты показываются даже без созданного диалога: для них рисуются synthetic direct entries;
- клик по synthetic direct entry создаёт/открывает директ через `room:direct:get-or-create` (`selectPrivate`), после чего список директов обновляется.
- при открытии `/chat?room=<id>` route-resolve теперь сначала использует реальные данные комнаты из `joinedRooms/publicRooms` (включая `postOnlyByAdmin` и `joined`), а не “пустую” заглушку; это убирает flicker composer/pin при возврате из `/console`.
- при переключении между диалогами введён флаг `dialogSwitching`: во время switch в ленте показывается только `Загрузка...` (без промежуточного `Нет сообщений` и без рендера старой ленты), что убирает flicker `old -> empty -> loading -> new`.
- надпись `Нет сообщений` в ленте чата полностью убрана, чтобы не было резкого мигания текста между состояниями загрузки/переключения.
- лимит upload-изображений поднят до `50MB` (backend `uploads.maxBytes`, frontend chat/console-ограничения);
- backend upload теперь дополнительно нормализует изображения (кроме `gif/svg`) до `max 1024x1024` с сохранением пропорций через `sharp`; это страхует кейсы, когда клиентское ужатие по какой-то причине не сработало.
- фикс пустого чата при первом входе через редирект `/chat -> /chat?room=<id>`: после включения `routeSyncReady` теперь принудительно вызывается `onRouteChanged()`, чтобы догнать пропущенное изменение маршрута и выбрать диалог без ручного refresh.
- web-push для direct теперь всегда приходит по каноническому URL `/chat?room=<directRoomId>&focusMessage=<messageId>`; клик по push открывает нужный диалог и сразу фокусит целевое сообщение без цепочки редиректов через `/direct/*`.
- service worker на `notificationclick` теперь нормализует переход по `roomId/messageId` из payload в `/chat?room=...&focusMessage=...`, даже если в `url` пришёл legacy-path.
- backend web-push дополнительно всегда исключает из получателей `senderId` и `message.authorId`, чтобы отправитель не получал push на собственные сообщения.
- openNotification в чате теперь в приоритете резолвит диалог по `roomId` (`buildDialogFromRoomRoute`), а не по `targetUser`; это убирает ложные переходы в неверный direct и fallback в `/chat`.
