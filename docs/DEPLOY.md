# Deploy (podman compose)

Минимальный каркас развёртывания находится в `deploy/`. Caddy используется **только на проде**.

## Быстрый старт

```bash
cd deploy
podman compose up -d
```

## Сервисы

- `caddy` — внешний reverse proxy и TLS
- `frontend` — Nuxt SPA на `8815`
- `backend` — API + WS на `8816`

Caddy завершает HTTPS и проксирует:

- `/api/*` → backend
- `/ws*` → backend
- остальное → frontend

## Конфиг

Скопируй `frontend/config.example.json` → `frontend/config.json` и
`backend/config.example.json` → `backend/config.json`, затем отредактируй под прод.

SQLite файл хранится в `backend/data/` (по умолчанию `backend/data/marx.sqlite`).
