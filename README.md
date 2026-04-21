# MARX

Закрытый чат для аварийной связи, mobile/PWA-first.

## Что умеет сейчас

- invite-only регистрация;
- логин по `nickname + password` (nickname нормализуется в lowercase);
- комнаты `group`/`direct` + сообщения/редактирование/удаление/реакции;
- игровой модуль King (`/games`), solo: 1 человек + 3 бота;
- автосоздание direct с системным пользователем `marx`;
- серверный рендер форматирования сообщений (`rawText` + `renderedHtml`);
- upload изображений (`/upload/image`, `/uploads/*`);
- web push (`/push/*` + service worker);
- VPN страница (`/vpn`) с WireGuard provisioning через `wg-admin`;
- Telegram news pipeline в `scripts/telegram-news`;
- smoke/e2e/stress скрипты.

## Стек

- `frontend/` — Nuxt 3 SPA (`ssr: false`), Element Plus, Tailwind, Less.
- `backend/` — NestJS + WS + HTTP, Prisma, PostgreSQL.
- Конфиг через JSON (`frontend/config.json`, `backend/config.json`, `scripts/config.json`).

## Быстрый старт (dev)

Нужно:
- Node.js 22+
- Yarn
- PostgreSQL 16+

Установка:
```bash
cd /path/to/chat
yarn install
cd backend && yarn install
cd ../frontend && yarn install
```

Конфиги:
```bash
cp backend/config.example.json backend/config.json
cp frontend/config.example.json frontend/config.json
cp scripts/config.example.json scripts/config.json
```

Запуск:
```bash
yarn run backend:dev
yarn run frontend:dev
```

Адреса:
- Frontend: `http://localhost:8815`
- Backend: `http://localhost:8816`
- WS: `ws://localhost:8816/ws`

## Первый пользователь

Для пустой БД:
```bash
yarn run user:bootstrap -- --nickname <name> --password <pass>
```

## Полезные команды

```bash
yarn run invite:create
yarn run invite:create -- --count 5
yarn run bots:seed
yarn run message:send -- --from <nickname> --chat group --text "текст"
yarn run db:init
cd backend && yarn run db:reset
yarn run test:login
yarn run smoke
yarn run stress:seed
```

`db:init` пересоздаёт БД и сидит dev-данные (`marx`, `lisov`, пароль `123`).

## Telegram news

```bash
cp scripts/telegram-news/config.example.json scripts/telegram-news/config.json
yarn run telegram:login
yarn run telegram:fetch
yarn run telegram:hot
yarn run telegram:rewrite -- --messageId <id>
yarn run telegram:digest
```

## Deploy

Актуальный деплой: [docs/DEPLOY.md](docs/DEPLOY.md) + [Caddyfile](Caddyfile).

## Документация

- [AGENTS.md](AGENTS.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/API.md](docs/API.md)
- [docs/CONFIG.md](docs/CONFIG.md)
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)
- [docs/KING_DISDOC.md](docs/KING_DISDOC.md)
