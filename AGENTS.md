# AGENTS.md

## Проект
`MARX` — mobile-first чат.

- `backend` — NestJS + Prisma + PostgreSQL + WebSocket
- `frontend` — Nuxt 3 SPA (`ssr:false`), Vue 3, Less
- основной транспорт: обычный WS
- резервный транспорт: MAX fallback только для Android APK через native Capacitor plugin

## Стиль работы
- без enterprise-херни
- без абстракций “на будущее”
- сначала логика, потом шаблон
- если шаг не двигает задачу — шаг не нужен

## Vue / frontend
- только Options API
- `data()` не использовать
- методы только в `methods`
- `this:any` в методах компонентов
- компонент: `index.vue` + `script.ts` + `style.less`
- package manager: `yarn`

## Каноника чата
- пакет WS: `[com, args, senderId, recipientId, requestId?]`
- новый MARX protocol не придумывать
- `room:list`, `contacts:list`, `user:list`, `room:group:get-default` не должны спамиться повторно без причины
- история комнаты кешируется по `roomId`; повторный вход в уже открытый диалог не должен дёргать `message:list`
- in-app переход в direct идёт через `/chat?room=<id>`, не через `/direct/<nickname>`

## Данные
- дерево только через `nodes.parent_id`
- `nodes.type`: `room | message`
- `rooms.id = nodes.id`
- `messages.id = nodes.id`
- `messages` не содержит `room_id`
- comment-room — это child room-node под message-node
- pinned: `rooms.pinned_node_id -> nodes.id`
- для anonymous `messages.sender_id` указывает на системного пользователя `anonymous`

## Scriptable/runtime
Сейчас по сути выключен.

- `message:create(kind='scriptable')` -> `scriptable_disabled`
- `runtime:action` -> `scriptable_disabled`
- `room:surface:set` -> `scriptable_disabled`
- `room:runtime:get` -> `roomRuntime:null`

Не оживлять это случайно.

## MAX fallback
- browser/WebView JS в MAX не лезет, это мёртвый путь
- fallback доступен только в Android native runtime
- backend держит обычный WS и MAX одновременно
- routing MAX: `<recipientId> <data>`
- `0` = backend
- `_clientId` = клиент до login
- `userId` = пользователь после login
- payload chunking уже есть, crypto/session модель не ломать
- при reserve-режиме история ужата до последних `10` сообщений
- в APK пользователь логинится сам; агент не вбивает логин/пароль на телефоне

## Конфиги
- backend: `backend/config.json`
- frontend: `frontend/config.json`
- smoke/e2e: `scripts/config.example.json`

`backend/config.json` обязателен для старта backend.

## Важные entry points
Backend:
- `backend/src/ws/chat.gateway.ts`
- `backend/src/ws/chat.commands.ts`
- `backend/src/ws/max-reserve.bridge.ts`
- `backend/src/common/native-push.ts`
- `backend/prisma/schema.prisma`

Frontend:
- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/composables/classes/ws.ts`
- `frontend/src/composables/classes/max-reserve-transport.ts`
- `frontend/src/pages/chat/*`
- `frontend/src/pages/console/*`
- `frontend/android/app/src/main/java/ru/core5/marx/*`

## Проверка после правок
- после фронтовых/WS правок — Playwright Chromium, не синтетика
- проверять локально login -> комнаты -> direct -> отправка -> возврат
- на mobile смотреть drawer без горизонтального переполнения
- локальный backend не должен падать, если в dev-БД нет `native_push_tokens`; native push должен деградировать в no-op
- traffic-check не должен создавать тестовые `traffic-room-*` комнаты; гонять на существующих `Общий чат` / `King` / direct с `marx`

## Команды
```bash
yarn run backend:dev
yarn run frontend:dev
yarn playwright test tests/chat-traffic.spec.ts --config=playwright.config.ts --project=chromium
yarn --cwd frontend generate
yarn --cwd frontend android:sync
```
