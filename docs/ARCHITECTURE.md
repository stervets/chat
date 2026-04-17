# Architecture

Проект разделён на два независимых приложения:

- `frontend/` — Nuxt 3 SPA, мобильный first, Element Plus + Tailwind + Less
- `backend/` — NestJS WebSocket API + HTTP upload endpoints, PostgreSQL (Prisma)

Конфигурация хранится в JSON (`frontend/config.json`, `backend/config.json`),
примеры — `frontend/config.example.json`, `backend/config.example.json`.

## Backend

- `src/main.ts` — запуск HTTP + WS
- `src/config.ts` — конфигурация и env
- `src/db.ts` — Prisma client + runtime DB checks
- `src/ws/chat.gateway.ts` — WebSocket транспорт и dispatch команд
- `src/ws/chat.service.ts` — бизнес-логика чата
- `src/http/uploads.controller.ts` — загрузка/выдача файлов
- `src/jobs/cleanup.ts` — TTL cleanup сообщений и uploads
- при старте backend проверяет PostgreSQL и завершает процесс, если БД недоступна

### Доменные ограничения

- регистрация только по invite-кодам
- логин по `nickname + password`
- общий чат и приватные диалоги
- сообщения хранятся как `raw_text` + серверно скомпилированный `rendered_html`
- хранение сообщений максимум N дней (`messagesTtlDays` в конфиге; cleanup job раз в час + запуск при старте)
- сессии на cookie, без JWT

## Dialogs & Messages

- общий чат хранится как `dialogs.kind = 'general'`
- приватные диалоги как `dialogs.kind = 'private'` с парой `member_a/member_b`
- история сообщений читается через HTTP, новые сообщения — через WebSocket

## Database

- `users`
- `invites`
- `dialogs` (global/direct)
- `messages` (TTL 7 дней)
- `message_reactions`
- `sessions`

Схема хранится в `backend/prisma/schema.prisma`.
Источник данных задаётся в `backend/config.json` (`db.url`).
