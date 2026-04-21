# Deploy (Caddy + static frontend + backend)

Текущая рабочая схема: Caddy + backend + PostgreSQL.

## Топология

- `caddy` — HTTPS reverse proxy + раздача статики фронта.
- `backend` — NestJS (HTTP + WS) на `127.0.0.1:8816`.
- `postgresql` — основная БД.

`Caddyfile` проксирует на backend:
- `/ws` и `/ws/*`
- `/push` и `/push/*`
- `/upload/image`
- `/uploads` и `/uploads/*`

Остальное раздаётся из `frontend/.output/public`.

## Требования

- Node.js 22+
- Yarn
- PostgreSQL 16+
- Caddy 2

## 1) Подготовка

```bash
git clone <repo_url> /opt/chat
cd /opt/chat

yarn install
cd backend && yarn install
cd ../frontend && yarn install
```

Создать конфиги:
```bash
cp backend/config.example.json backend/config.json
cp frontend/config.example.json frontend/config.json
```

Минимум в `backend/config.json`:
- `db.url`
- `corsOrigins`
- при необходимости `push.*` и `wgAdminSocketPath`.

## 2) БД

### Обновление существующей БД

```bash
cd /opt/chat/backend
./update-db.sh
```

`update-db.sh` берёт `db.url` из `backend/config.json` и делает `prisma db push`.

### Ручные SQL миграции

Если в релизе есть SQL в `backend/prisma/manual/*.sql`:
1. backup;
2. остановить backend;
3. применить SQL;
4. собрать backend и поднять обратно.

Для King stage 1 актуален файл:
- `backend/prisma/manual/20260421_king_stage1.sql`

После King stage 1 нужно засидить ботов:
```bash
cd /opt/chat/backend
yarn bots:seed
```

### Новый стенд

```bash
cd /opt/chat
yarn run db:init
```

`db:init` пересоздаёт БД и сидит dev-данные (`marx/lisov`). Не запускать на живой базе.

## 3) Сборка frontend

```bash
cd /opt/chat/frontend
yarn run generate
```

## 4) Сборка/запуск backend

```bash
cd /opt/chat/backend
yarn run build
yarn run start
```

Обычно backend лучше держать как systemd service.

## 5) Caddy

Ориентир: `Caddyfile` в корне репы.

Ключевая идея:
- backend-роуты -> `127.0.0.1:8816`
- SPA -> `frontend/.output/public` c fallback `/200.html`

## 6) Чеклист релиза

1. `git pull`
2. backup БД
3. применить ручные SQL миграции (если есть)
4. `backend/update-db.sh` (если нужен `db push`)
5. пересобрать frontend (`generate`)
6. пересобрать/перезапустить backend
7. при King stage 1: `yarn bots:seed`
8. reload Caddy, если менялся `Caddyfile`

## Нюансы

- backend на старте делает `checkDb()` и падает, если БД недоступна;
- runtime индексы `rooms_kind_idx` и `rooms_users_user_idx` создаются кодом на старте;
- cleanup (messages/uploads) выполняется на старте и каждый час.
