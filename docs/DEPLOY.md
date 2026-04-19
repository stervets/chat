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
- `backend` — WS API на `8816`

Caddy завершает HTTPS и проксирует:

- `/ws*` → backend
- `/push*` → backend
- `/uploads*` → backend
- остальное → frontend

## Конфиг

Скопируй `frontend/config.example.json` → `frontend/config.json` и
`backend/config.example.json` → `backend/config.json`, затем отредактируй под прод.

В `backend/config.json` обязательно укажи `db.url` до PostgreSQL.

## Что backend делает на старте

- проверяет подключение к PostgreSQL;
- создаёт runtime partial unique indexes (если их нет):
  - `dialogs_general_unique`
  - `dialogs_private_unique`
- запускает cleanup сообщений/uploads сразу при старте.

Важно: runtime indexes создаются кодом (`backend/src/db.ts`) как safety-step.
Это не Prisma migration.

## Cleanup scheduler

- после старта cleanup запускается раз в час;
- привязки к timezone нет;
- удаляются сообщения старше `messagesTtlDays`;
- дополнительно держится лимит `5000` сообщений на диалог;
- prune uploads старше TTL.
