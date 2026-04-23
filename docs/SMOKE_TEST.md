# Smoke Test

Тесты рассчитаны на PostgreSQL и свободные порты `8815/8816`.

## Подготовка

```bash
yarn install
npx playwright install chromium
```

Если нужна чистая локальная БД под новую схему:

```bash
yarn --cwd backend run db:init
```

Если нужно мигрировать старую локальную БД с legacy-схемы:

```bash
yarn --cwd backend run db:migrate:nodes
```

## Быстрый smoke

```bash
yarn run smoke
```

Минимум после фронтовых/WS правок:

```bash
yarn run test:login
```

## Ручная проверка

1. Запуск сервисов:

```bash
yarn run backend:dev
yarn run frontend:dev
```

2. Создать invite:

```bash
yarn run invite:create
```

3. Зарегистрировать 2 пользователей и открыть `/chat` в двух окнах.

4. Проверить:

- общий чат `group` работает;
- direct-диалог между пользователями создаётся и открывается;
- отправка, edit, delete, reactions работают;
- pinned в non-direct работает, в direct недоступен;
- pinned scriptable message остаётся интерактивным;
- room surface продолжает работать через `room:surface:set`;
- кнопка `комментарии+` создаёт comment room и повторно использует её;
- comment room открывается как обычная room, а `к посту` возвращает в исходную;
- после удаления исходного сообщения comment room не пропадает, но header показывает удалённый источник;
- анонимная отправка пишет `sender_id = NULL`, в UI автор = `Аноним`;
- `users.name` может совпадать у нескольких пользователей, поиск не должен ломаться;
- offline/reconnect не ломает pinned/scriptable runtime.

5. После проверки остановить процессы backend/frontend.

## Что больше не проверяем

- `graph:*`
- `/spaces`
- `space/folder/room_ref`

Эта модель выпилена и не должна всплывать ни в тестах, ни в UI.
