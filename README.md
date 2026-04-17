# MARX

Закрытый чат для аварийной связи. Регистрация по invite-кодам, логин по `nickname + password`, общий чат и приватные диалоги.

## Никнеймы

- `nickname` хранится только в lowercase.
- `USER` и `user` считаются одним и тем же никнеймом.
- Формат: `^[a-z0-9_-]{3,32}$`.

## Быстрый старт (dev)

Нужно:
- Node.js 22+
- Yarn
- PostgreSQL 16+ (или контейнер с Postgres)

1. Установи зависимости.

```bash
cd backend
yarn install
cd ../frontend
yarn install
```

2. Создай локальные конфиги.

```bash
cp backend/config.example.json backend/config.json
cp frontend/config.example.json frontend/config.json
```

3. Запусти сервисы в двух терминалах (из корня проекта).

```bash
yarn run backend:dev
yarn run frontend:dev
```

## Адреса

- Frontend: `http://localhost:8815` или `http://127.0.0.1:8815`
- Backend: `http://localhost:8816` или `http://127.0.0.1:8816`
- БД по умолчанию: `postgresql://postgres:postgres@127.0.0.1:5432/marx?schema=public`

## Auth модель

- Используются session token-ы (не JWT).
- `auth:login` и `invites:redeem` возвращают `token` и `expiresAt`.
- Токен хранится на клиенте в `localStorage` (`marx_session_token`).
- Восстановление сессии идёт через WS команду `auth:session`.
- Upload (`POST /upload/image`) принимает `Authorization: Bearer <token>`.
- Cookie-based сессии не используются.

## Проверка БД при старте

- Backend при старте проверяет подключение к PostgreSQL.
- Backend создаёт runtime partial unique indexes, если их нет:
  - `dialogs_general_unique`
  - `dialogs_private_unique`
- Это runtime safety-шаг, а не Prisma migration.

## Первый пользователь (без invite)

1. Если нужно начать с нуля, сбрось БД:

```bash
cd backend
yarn run db:reset
```

2. Создай первого пользователя **секретной командой** (из корня):

```bash
yarn run user:bootstrap -- --nickname <name> --password <pass>
```

3. Зайди через `/login` и дальше выдавай инвайты.

## Как получить инвайт

Через UI: страница `/invites`, кнопка `Создать инвайт`.

Через CLI (из корня):

```bash
yarn run invite:create
yarn run invite:create -- --count 5
```

## Базовый flow

1. Первый пользователь создаётся командой `user:bootstrap`.
2. Создай invite через UI или CLI.
3. Открой `http://localhost:8815/invite/<code>` и зарегистрируйся.
4. Перейди в `/chat`.

## Формат сообщений

- В БД хранятся `rawText` и `renderedHtml`.
- Форматирование компилируется на сервере при create/edit.
- Клиент рендерит готовый `renderedHtml`.
- `rawText` используется для редактирования.

## Конфигурация

Примеры — `frontend/config.example.json` и `backend/config.example.json`.
Рабочие файлы — `frontend/config.json` и `backend/config.json`.
Подробности в `docs/CONFIG.md`.
