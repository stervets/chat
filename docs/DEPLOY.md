# Deploy (Caddy + static frontend + backend)

Текущая рабочая схема: Caddy + backend + PostgreSQL.

## Актуальный прод (celesta)

- проект: `/home/lisov/projects/chat`
- PostgreSQL: rootless `podman` контейнер `marx-postgres` (`127.0.0.1:5432->5432/tcp`)
- backend: user-level systemd unit `~/.config/systemd/user/marx-backend.service`
- backend unit `WorkingDirectory`: `/home/lisov/projects/chat/backend`
- backend unit `ExecStart`: `/home/lisov/.nvm/versions/node/v24.15.0/bin/yarn start`

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
- Podman (rootless)
- PostgreSQL 16+
- Caddy 2

## 1) Подготовка

```bash
git clone <repo_url> /home/lisov/projects/chat
cd /home/lisov/projects/chat

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
cd /home/lisov/projects/chat/backend
./update-db.sh
```

`update-db.sh` берёт `db.url` из `backend/config.json` и делает `prisma db push`.

### Ручные SQL миграции

Если в релизе есть SQL в `backend/prisma/manual/*.sql`:
1. backup;
2. остановить backend;
3. применить SQL;
4. собрать backend и поднять обратно.

Актуальные ручные SQL (если применяешь вручную, а не через `prisma migrate deploy`):
- `backend/prisma/manual/20260421_king_stage1.sql`
- `backend/prisma/manual/20260422_allow_non_unique_user_names.sql`

После King stage 1 нужно засидить ботов:
```bash
cd /home/lisov/projects/chat/backend
yarn bots:seed
```

### Новый стенд

```bash
cd /home/lisov/projects/chat
yarn run db:init
```

`db:init` пересоздаёт БД и сидит dev-данные (`marx/lisov`). Не запускать на живой базе.

## 3) Сборка frontend

```bash
cd /home/lisov/projects/chat/frontend
yarn run generate
```

## 4) Сборка/запуск backend

```bash
cd /home/lisov/projects/chat/backend
yarn run build
yarn run start
```

В проде backend запускается как user-level systemd service:

```ini
[Unit]
Description=MARX backend
After=network.target marx-postgres.service
Wants=marx-postgres.service

[Service]
Type=simple
WorkingDirectory=/home/lisov/projects/chat/backend
ExecStart=/home/lisov/.nvm/versions/node/v24.15.0/bin/yarn start
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Файл: `~/.config/systemd/user/marx-backend.service`

Базовые команды:
```bash
systemctl --user daemon-reload
systemctl --user enable --now marx-backend.service
systemctl --user restart marx-backend.service
systemctl --user status marx-backend.service
journalctl --user -u marx-backend.service -f
```

Проверка PostgreSQL контейнера:
```bash
podman ps --filter name=marx-postgres
podman logs marx-postgres --tail=100
```

## 5) Caddy

Ориентир: `Caddyfile` в корне репы.

Ключевая идея:
- backend-роуты -> `127.0.0.1:8816`
- SPA -> `frontend/.output/public` c fallback `/200.html`

### Maintenance Mode (toggle)

Для серверного переключения "техработ" через Caddy смотри:
- `docs/OPS_MAINTENANCE_MODE.md`

Там есть:
- готовая статическая страница техработ;
- один toggle-скрипт ON/OFF;
- include-файлы для Caddy и пример подключения.

## 6) Чеклист релиза

1. `git pull`
2. backup БД
3. применить ручные SQL миграции (если есть)
4. `backend/update-db.sh` (если нужен `db push`)
5. пересобрать frontend (`generate`)
6. пересобрать backend и перезапустить `systemctl --user restart marx-backend.service`
7. при King stage 1: `yarn bots:seed`
8. reload Caddy, если менялся `Caddyfile`

## Нюансы

- backend на старте делает `checkDb()` и падает, если БД недоступна;
- runtime индексы `rooms_kind_idx` и `rooms_users_user_idx` создаются кодом на старте;
- cleanup (messages/uploads) выполняется на старте и каждый час.
