# MARX

Закрытый чат для аварийной связи. Регистрация только по invite-кодам, логин по `nickname + password`, общий чат и приватные диалоги. Минимальный каркас без лишних фич.

## Конфигурация

Проект использует JSON-конфиги. Примеры — `frontend/config.example.json` и `backend/config.example.json`.
Локальные рабочие файлы: `frontend/config.json`, `backend/config.json`. Подробности в `docs/CONFIG.md`.

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

Через UI: страница `/invites`, кнопка `Создать инвайт`.

## Базовый flow

1. Сгенерируй инвайт через CLI.
2. Открой `http://localhost:8815/invite/<code>` и зарегистрируйся.
3. Перейди в `/chat` или `/invites`.

## Порты

- Frontend: `8815`
- Backend: `8816`

SQLite файл по умолчанию: `backend/data/marx.sqlite` (см. `backend/config.json`).
Backend использует настройки из `backend/config.json` и **не стартует**, если SQLite не удалось открыть/инициализировать (fail-fast).
