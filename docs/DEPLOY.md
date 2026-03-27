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
- `postgres` — база

Caddy завершает HTTPS и проксирует:

- `/api/*` → backend
- `/ws*` → backend
- остальное → frontend

## Конфиг

Перед сборкой/деплоем отредактируй `frontend/config.json` и `backend/config.json` под прод.
