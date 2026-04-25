# Миграция старой БД MARX Chat в новую nodes-схему

## Главное

В `chat_new.zip` уже есть `backend/src/scripts/migrate-to-nodes.ts`, но для текущего `chat.zip` он опасен: он обращается к колонкам, которых в старой схеме нет (`rooms.app_enabled`, `rooms.app_type`, `rooms.app_config_json`, `messages.discussion_room_id`), и не доводит схему до финального состояния текущей новой версии.

Используй файл `migrate-to-nodes.safe.ts` как замену штатного скрипта.

## Что делает безопасный скрипт

- Проверяет, что перед ним старая схема с `messages.room_id`.
- Архивирует уже использованные инвайты, чтобы после удаления `used_at` они случайно не стали активными снова.
- Переименовывает старые таблицы в `*_legacy`, а не удаляет их сразу.
- Создаёт новую схему `nodes`, `rooms`, `messages`, `invites_rooms`, `users_contacts` и остальные нужные таблицы.
- Переносит комнаты, сообщения, участников, реакции, игровые сессии, игроков и закрепы.
- Сохраняет старые `rooms.id` как новые `rooms.id`, чтобы ссылки на комнаты не поехали без нужды.
- Переносит активные старые инвайты так, чтобы они давали доступ ко всем старым group-комнатам, как раньше.
- Проверяет счётчики и связи.
- Помечает Prisma migrations как применённые, чтобы `prisma migrate deploy` потом не попытался накатить разрушительную миграцию поверх живой БД.

## Как запускать на сервере

### 1. Скопировать скрипт в новую версию

```bash
cp migrate-to-nodes.safe.ts chat_new/backend/src/scripts/migrate-to-nodes.ts
```

### 2. Остановить процессы чата

Останови backend и script runner. На время миграции в БД не должно быть записей.

### 3. Сделать backup

```bash
cd chat_new/backend
export DATABASE_URL="$(node -e "console.log(require('./config.json').db.url)")"
pg_dump "$DATABASE_URL" -Fc -f "../backup-before-nodes-$(date +%F_%H%M%S).dump"
```

### 4. Не запускать Prisma migrate до миграции

Не делай это перед переносом данных:

```bash
yarn prisma:migrate:deploy
```

Иначе можно получить красивый свежий костёр вместо данных.

### 5. Запустить миграцию

```bash
cd chat_new/backend
export DATABASE_URL="$(node -e "console.log(require('./config.json').db.url)")"
yarn run db:migrate:nodes
```

Успешный финал:

```text
nodes migration completed successfully
```

### 6. Сгенерировать Prisma client

```bash
yarn prisma:generate
```

### 7. Запустить новую версию

Запускай backend/frontend новой версии и проверь вручную:

- вход существующим пользователем;
- общий чат;
- старые сообщения;
- директ;
- реакции;
- закреп;
- создание комнаты;
- профиль;
- создание инвайта;
- регистрация или применение инвайта.

## После релиза

Скрипт оставляет старые таблицы `*_legacy`. Это специально: если что-то пойдёт боком, данные всё ещё рядом.

Удалять legacy-таблицы лучше не в день релиза. Когда всё проверено и backup точно живой, можно выполнить:

```bash
cd chat_new/backend
export DATABASE_URL="$(node -e "console.log(require('./config.json').db.url)")"
MIGRATION_DROP_LEGACY_TABLES=1 yarn run db:migrate:nodes
```

## Если миграция упала

Скрипт работает в транзакции. Если он падает, он делает rollback. Исправляешь причину и запускаешь снова.

Если что-то пошло совсем в ад:

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" ../backup-before-nodes-YYYY-MM-DD_HHMMSS.dump
```
