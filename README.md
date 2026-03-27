# MARX

Закрытый чат для аварийной связи. Регистрация только по invite-кодам, логин по `nickname + password`, общий чат и приватные диалоги. Минимальный каркас без лишних фич.

## Конфигурация

Проект использует JSON-конфиги, см. `docs/CONFIG.md`.

## Локальный запуск (dev)

Из корня проекта:

```bash
yarn run frontend:dev
yarn run backend:dev
```

Frontend напрямую:

```bash
cd frontend
yarn install
yarn run dev
```

Backend напрямую:

```bash
cd backend
yarn install
yarn run dev
```

## Invite CLI (из корня)

```bash
yarn run invite:create
yarn run invite:create -- --count 5
```

## Базовый flow

1. Сгенерируй инвайт через CLI.
2. Открой `http://localhost:8815/invite/<code>` и зарегистрируйся.
3. Перейди в `/chat`.

## Порты

- Frontend: `8815`
- Backend: `8816`
- PostgreSQL: `5432` (локально или через `deploy/compose.yml`)

Backend использует настройки из `backend/config.json`. Если PostgreSQL не запущен, сервер всё равно стартует, но выдаст ошибку подключения в логах.
