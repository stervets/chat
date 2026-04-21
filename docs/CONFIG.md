# Config

Проект использует JSON-конфиги.

## Backend

Файлы:
- `backend/config.example.json` — пример
- `backend/config.json` — рабочий локальный/серверный

Минимальный пример:
```json
{
  "host": "0.0.0.0",
  "port": 8816,
  "wsPath": "/ws",
  "wgAdminSocketPath": "/run/wg-admin.sock",
  "corsOrigins": ["http://localhost:8815"],
  "uploads": {
    "path": "./data/uploads",
    "maxBytes": 1048576
  },
  "vpn": {
    "donationPhone": "+7-999-999-9999",
    "donationBank": "Райффайзенбанк"
  },
  "push": {
    "vapidPublicKey": "",
    "vapidPrivateKey": "",
    "vapidSubject": ""
  },
  "db": {
    "url": "postgresql://postgres:postgres@127.0.0.1:5432/marx?schema=public"
  }
}
```

Поля:
- `host`, `port`, `wsPath` — backend bind + WS path.
- `wgAdminSocketPath` — unix socket `wg-admin`.
- `inviteBaseUrl` — optional, если пусто вычисляется из `corsOrigins`.
- `corsOrigins` — CORS.
- `uploads.path`, `uploads.maxBytes` — upload storage/лимит.
- `vpn.*` — реквизиты для `/vpn`.
- `push.*` — VAPID для web-push.
- `db.url` — runtime подключение backend к PostgreSQL.

## Frontend

Файлы:
- `frontend/config.example.json`
- `frontend/config.json`

Минимальный пример:
```json
{
  "mode": "dev",
  "apiUrl": "http://localhost:8816",
  "wsPath": "/ws",
  "publicUrl": ""
}
```

Поля:
- `apiUrl` — базовый HTTP URL backend.
- `wsPath` — WS path.
- `wsUrl` — optional override; если не задан, строится из `apiUrl + wsPath`.
- `publicUrl` — публичный URL фронта (используется в UI/шаринге).
- `vpn.*` — ссылки MTProxy/Amnezia и имена файлов.

## Scripts

Файлы:
- `scripts/config.example.json`
- `scripts/config.json`

Используется для:
- `playwright` runtime;
- `e2eLogin` smoke login (`tests/login.spec.ts`);
- `smokeE2E` (`scripts/smoke-e2e.js`);
- `stressSeed` (`scripts/stress-seed.js`).

## Важный момент по Prisma

- runtime backend берёт DB URL из `backend/config.json -> db.url`;
- Prisma schema (`backend/prisma/schema.prisma`) использует `env("DATABASE_URL")`.

Перед `prisma generate/db push/migrate` выравнивай `DATABASE_URL` с нужной БД.
