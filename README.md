# Marx Chat

Закрытый чат для аварийной связи. Регистрация только по invite-кодам, логин по `nickname + password`, общий чат и приватные диалоги. Минимальный каркас без лишних фич.

## Конфигурация

Проект использует JSON-конфиги, см. `docs/CONFIG.md`.

## Локальный запуск (dev)

Frontend:

```bash
cd frontend
yarn install
yarn run dev
```

Backend:

```bash
cd backend
yarn install
yarn run dev
```

## Порты

- Frontend: `8815`
- Backend: `8816`
- PostgreSQL: `5432` (локально или через `deploy/compose.yml`)

Backend использует настройки из `backend/config.json`. Если PostgreSQL не запущен, сервер всё равно стартует, но выдаст ошибку подключения в логах.
