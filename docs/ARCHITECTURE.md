# Architecture

Проект разделён на два независимых приложения:

- `frontend/` — Nuxt 3 SPA, мобильный first, Element Plus + Tailwind + Less
- `backend/` — NestJS WebSocket API + HTTP upload endpoints, PostgreSQL (Prisma)

Конфигурация хранится в JSON (`frontend/config.json`, `backend/config.json`),
примеры — `frontend/config.example.json`, `backend/config.example.json`.

## Backend

- `src/main.ts` — запуск HTTP + WS
- `src/config.ts` — конфигурация и env
- `src/db.ts` — Prisma client + runtime DB checks + runtime indexes
- `src/ws/chat.gateway.ts` — WebSocket транспорт и dispatch команд
- `src/ws/chat.service.ts` — бизнес-логика чата
- `src/http/uploads.controller.ts` — загрузка/выдача файлов
- `src/jobs/cleanup.ts` — TTL cleanup сообщений и uploads (run on startup + hourly)
- при старте backend проверяет PostgreSQL и завершает процесс, если БД недоступна

### Доменные ограничения

- регистрация только по invite-кодам
- логин по `nickname + password`
- auth на session token-ах (не JWT и не cookie session)
- общий чат и приватные диалоги
- сообщения хранятся как `raw_text` + серверно скомпилированный `rendered_html`
- `raw_text` нужен для редактирования; `rendered_html` клиент рендерит как готовый HTML
- хранение сообщений максимум N дней (`messagesTtlDays` в конфиге; cleanup job раз в час + запуск при старте)
- upload авторизуется через `Authorization: Bearer <session_token>`

## Dialogs & Messages

- общий чат хранится как `dialogs.kind = 'general'`
- приватные диалоги как `dialogs.kind = 'private'` с парой `member_a/member_b`
- история/отправка/редактирование/удаление сообщений идут через WebSocket
- HTTP используется только для upload/download файлов (`/upload/image`, `/uploads/:name`)

## Runtime Indexes

В `src/db.ts` на старте backend выполняет runtime safety-шаг:

- `create unique index if not exists dialogs_general_unique ... where kind='general'`
- `create unique index if not exists dialogs_private_unique ... where kind='private' and member_a/member_b is not null`

Это не Prisma migration, а стартовая проверка-страховка, чтобы в БД сохранялись ограничения на единственный `general` и уникальные private-пары.

## Auth Flow

- login/register (`auth:login`, `invites:redeem`) возвращают `token` + `expiresAt`.
- фронт хранит token в `localStorage` (`marx_session_token`).
- восстановление сессии выполняется через WS `auth:session` с token.
- `auth:logout` удаляет server-side session по token.

## Database

- `users`
- `invites`
- `dialogs` (global/direct)
- `messages` (TTL 7 дней)
- `message_reactions`
- `sessions`

Схема хранится в `backend/prisma/schema.prisma`.
Источник данных задаётся в `backend/config.json` (`db.url`).
