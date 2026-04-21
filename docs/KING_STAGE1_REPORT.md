# King Stage 1 Report

> Исторический отчёт по внедрению stage 1.
> Для текущего состояния смотри: `docs/KING_DISDOC.md`, `docs/API.md`, `docs/ARCHITECTURE.md`.

## Что сделано

- Добавлен runtime-слой модулей и первый модуль `king`.
- В `rooms.kind` добавлена поддержка `game`.
- Добавлены игровые таблицы `game_sessions` и `game_session_players`.
- Реализован solo-flow: 1 человек + 3 бота.
- Реализована детерминированная серверная логика матча из 12 раундов.
- Добавлены эвристические боты (без LLM) и шаблонные реплики с ограничением спама.
- Добавлен seed-скрипт ботов как обычных пользователей (`users.is_bot/info`, nickname с `!`).
- Добавлен минимальный frontend lobby и mobile portrait-first экран матча.

## Изменённые файлы

- `backend/prisma/schema.prisma`
- `backend/prisma/manual/20260421_king_stage1.sql`
- `backend/src/db.ts`
- `backend/src/common/nickname.ts`
- `backend/src/common/rooms.ts`
- `backend/src/common/types.ts`
- `backend/src/common/web-push.ts`
- `backend/src/ws/chat.gateway.ts`
- `backend/src/ws/chat/chat.service.ts`
- `backend/src/ws/chat/chat-games.service.ts`
- `backend/src/cli/db-reset.ts`
- `backend/package.json`
- `package.json`
- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/composables/king.ts`
- `frontend/src/pages/chat/index.vue`
- `docs/DEPLOY.md`

## Новые файлы

- `backend/src/modules-runtime/types.ts`
- `backend/src/modules-runtime/registry.ts`
- `backend/src/modules/king/module.ts`
- `backend/src/modules/king/types.ts`
- `backend/src/modules/king/rounds.ts`
- `backend/src/modules/king/scoring.ts`
- `backend/src/modules/king/rules.ts`
- `backend/src/modules/king/bot-strategy.ts`
- `backend/src/modules/king/bot-cast.ts`
- `backend/src/modules/king/templates.ts`
- `backend/src/scripts/bots.seed.ts`
- `frontend/src/pages/games/index.vue`
- `frontend/src/pages/games/script.ts`
- `frontend/src/pages/games/style.less`
- `frontend/src/pages/games/session/[id]/index.vue`
- `frontend/src/pages/games/session/[id]/script.ts`
- `frontend/src/pages/games/session/[id]/style.less`
- `docs/KING_STAGE1_REPORT.md`

## Локальный запуск

```bash
# backend
cd backend
yarn prisma:generate
yarn build
yarn bots:seed
yarn dev

# frontend
cd frontend
yarn dev
```

## Порядок выката на сервер

1. Backup БД:
```bash
cd /opt/chat
mkdir -p backups
TS=$(date +%F_%H%M%S)
podman exec -i trade-pg pg_dump -U postgres -d marx -Fc > backups/marx_${TS}.dump
ls -lh backups/marx_${TS}.dump
```

2. Остановить backend:
```bash
systemctl stop marx-backend
```

3. Применить SQL-миграцию:
```bash
podman exec -i trade-pg psql -U postgres -d marx -v ON_ERROR_STOP=1 \
  < /opt/chat/backend/prisma/manual/20260421_king_stage1.sql
```

4. Обновить Prisma/client, собрать и поднять backend:
```bash
cd /opt/chat/backend
yarn prisma:generate
yarn build
systemctl start marx-backend
```

5. Засидить ботов:
```bash
cd /opt/chat/backend
yarn bots:seed
```

## Что проверить руками

1. Логин пользователя.
2. Переход в `/games`, запуск `King -> Играть с ботами`.
3. Создались `room(kind=game)`, `game_session`, `game_session_players`.
4. У человека видна рука, у оппонентов видны только счётчики карт.
5. Карты грузятся из `frontend/src/public/cards/*.gif`.
6. Нельзя сходить картой вне допустимых ходов (follow suit).
7. После хода человека боты доигрывают автоматически.
8. Взятка определяется корректно, счёт меняется.
9. Раунды переходят 1 -> 12, матч завершается.
10. В комнате матча идут системные сообщения и реплики ботов (без спама).
11. UI usable на мобильной ширине (portrait).

## Сознательные упрощения этапа 1

- Только `visibility=solo` в фактическом флоу (schema готова под остальные режимы).
- Единственное действие игрока: `play_card`.
- Боты только эвристические, без LLM.
- Реплики ботов только по шаблонам и только по ключевым событиям.
- Для раундов `mishmash_minus/mishmash_plus` выбран последовательный вариант:
  - `mishmash_minus` = сумма штрафов из минусовых правил,
  - `mishmash_plus` = зеркальная позитивная сумма по тем же сущностям.
