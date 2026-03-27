# Architecture

Проект разделён на два независимых приложения:

- `frontend/` — Nuxt 3 SPA, мобильный first, Element Plus + Tailwind + Less
- `backend/` — простой HTTP + WebSocket сервер на Fastify, PostgreSQL

Конфигурация хранится в JSON (`frontend/config.json`, `backend/config.json`).

## Backend

- `src/main.ts` — запуск HTTP + WS
- `src/config.ts` — конфигурация и env
- `src/db.ts` — pg pool
- `src/modules/*` — модули домена
- `src/ws/*` — скелет событий WebSocket

### Доменные ограничения

- регистрация только по invite-кодам
- логин по `nickname + password`
- общий чат и приватные диалоги
- сообщения — plain text, без HTML
- хранение сообщений максимум 7 дней (cleanup job заготовлен)
- сессии на cookie, без JWT

## Dialogs & Messages

- общий чат хранится как `dialogs.kind = 'general'`
- приватные диалоги как `dialogs.kind = 'private'` с парой `member_a/member_b`
- история сообщений читается через HTTP, новые сообщения — через WebSocket

## Database

`backend/sql/001_init.sql` содержит базовую схему:

- `users`
- `invites`
- `dialogs` (global/direct)
- `messages` (TTL 7 дней)
- `sessions`
