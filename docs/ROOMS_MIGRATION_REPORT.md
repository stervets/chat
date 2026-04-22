# Rooms Migration Report

> Исторический отчёт по миграции `dialogs -> rooms`.
> Для текущего состояния смотри: `docs/ARCHITECTURE.md`, `docs/API.md`, `AGENTS.md`.

## Что заменено

- `dialogs` -> `rooms`
- `dialogs.kind: general | private` -> `rooms.kind: group | direct`
- `dialogs.member_a/member_b` -> `rooms_users (room_id, user_id)`
- `messages.dialog_id` -> `messages.room_id`
- backend runtime payload/типы: `dialogId` -> `roomId`

## Изменённые файлы

- `backend/prisma/manual/20260420_rooms_migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/common/rooms.ts`
- `backend/src/common/web-push.ts`
- `backend/src/common/types.ts`
- `backend/src/db.ts`
- `backend/src/jobs/cleanup.ts`
- `backend/src/ws/protocol.ts`
- `backend/src/ws/chat.gateway.ts`
- `backend/src/ws/chat/chat-auth.service.ts`
- `backend/src/ws/chat/chat-context.ts`
- `backend/src/ws/chat/chat-dialogs.service.ts`
- `backend/src/ws/chat/chat-invites.service.ts`
- `backend/src/ws/chat/chat-messages.service.ts`
- `backend/src/ws/chat/chat-reactions.service.ts`
- `backend/src/ws/chat/chat.service.ts`
- `backend/src/cli/db-init.ts`
- `backend/src/cli/db-reset.ts`
- `backend/src/cli/message-send.ts`
- `backend/src/common/dialogs.ts` (удалён)
- `frontend/src/composables/types.ts`
- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/public/sw.js`
- `frontend/src/pages/chat/index.vue`
- `frontend/src/pages/chat/script.ts`
- `frontend/src/pages/chat/chat-page.constants.ts`
- `frontend/src/pages/chat/modules/methods-auth-dialogs-and-profile.ts`
- `frontend/src/pages/chat/modules/methods-composer-and-virtual.ts`
- `frontend/src/pages/chat/modules/methods-message-body-and-reactions.ts`
- `frontend/src/pages/chat/modules/methods-notifications.ts`
- `frontend/src/pages/chat/modules/methods-runtime-and-routing.ts`
- `frontend/src/pages/chat/modules/methods-send-upload-and-runtime.ts`

## Порядок выката на сервер

1. Backup базы (PostgreSQL в `podman` контейнере)

```bash
cd /home/lisov/projects/chat
mkdir -p backups
TS=$(date +%F_%H%M%S)

# пример для контейнера "marx-postgres"
podman exec -i marx-postgres pg_dump -U postgres -d marx -Fc > backups/marx_${TS}.dump
ls -lh backups/marx_${TS}.dump
```

2. Остановка backend

```bash
# пример
systemctl --user stop marx-backend.service
# или ваш процесс-менеджер (pm2/supervisor/manual)
```

3. Запуск SQL-миграции

```bash
cd /home/lisov/projects/chat
podman exec -i marx-postgres psql -U postgres -d marx -v ON_ERROR_STOP=1 \
  < backend/prisma/manual/20260420_rooms_migration.sql
```

4. Prisma generate / build / restart

```bash
cd /home/lisov/projects/chat/backend
yarn prisma:generate
yarn build

# пример
systemctl --user start marx-backend.service
```

Если фронт собираете на сервере отдельно:

```bash
cd /home/lisov/projects/chat/frontend
yarn build
# затем рестарт фронт-процесса
```

## Что проверить руками после запуска

- логин работает
- список комнат/директов открывается
- бывшая `general` (теперь `group`) открывается
- существующие direct-комнаты открываются
- история сообщений на месте
- отправка сообщений работает
- редактирование/удаление/реакции работают
- удаление direct-комнаты работает

## Комментарий по миграции

SQL-скрипт делает перенос в транзакции, сохраняет `dialogs.id -> rooms.id`,
переносит участников в `rooms_users`, переключает FK `messages` на `rooms`,
и только после этого удаляет старую структуру.

## Подсказка по контейнеру PostgreSQL

Если имя контейнера другое, найди его так:

```bash
podman ps --format '{{.Names}}\t{{.Image}}' | grep -i postgres
```
