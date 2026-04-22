# Smoke Test

Тесты рассчитаны на PostgreSQL и свободные порты `8815/8816`.

## Быстрый headless smoke

Подготовка:
```bash
cd /path/to/chat
yarn install
npx playwright install chromium
```

Запуск:
```bash
yarn run smoke
```

Скрипт `scripts/smoke-e2e.js` делает автоматически:
1. `cd backend && yarn run db:reset`.
2. `user:bootstrap` (`lisov/123`).
3. Поднимает `backend:dev` и `frontend:dev`.
4. Логинит первого пользователя.
5. Создаёт invite через `/invites`.
6. Регистрирует второго пользователя.
7. Проверяет обмен сообщениями в общем чате.
8. Проверяет подсветку сообщения с `@all`.
9. Проверяет image preview в сообщении.
10. Проверяет форматирование и реакции.
11. Проверяет edit/delete сообщений.
12. Проверяет приватный диалог между пользователями.
13. Глушит процессы backend/frontend.

## Отдельный login smoke

Если нужно проверить только логин:
```bash
yarn run test:login
```

Тест читает `scripts/config.json -> e2eLogin`.

## Ручная проверка (минимум)

1. Запуск сервисов:
```bash
yarn run backend:dev
yarn run frontend:dev
```

2. Создать инвайт:
```bash
yarn run invite:create
```

3. Зарегистрировать 2 пользователей (`/invite/<code>`), открыть `/chat` в двух окнах.

4. Проверить:
- доставка сообщений в `group`;
- direct-диалог между пользователями;
- edit/delete/reactions;
- pinned message:
  - в `group`: pin/unpin только админ комнаты;
  - в `direct`: pin/unpin недоступны;
  - pinned может быть `scriptable`: UI в плашке интерактивный (кнопки/действия работают);
  - если один и тот же scriptable message одновременно виден в ленте и в pinned, runtime один (нет второго worker и дубля side-effects);
  - после временного offline/online (reconnect) scriptable runtime продолжает работать без повторного старта второго runtime;
  - pinned panel: collapse/expand, drag splitter, max-height 50%;
  - после перезагрузки страницы сохраняются: состояние collapse/expand и высота pinned panel;
- анонимная отправка:
  - включить галку `Отправить анонимно` в composer tools;
  - в ленте автор должен быть `Аноним`;
  - backend хранит сообщение с `sender_id = NULL`;
- поиск пользователей:
  - по одинаковому `name` должны выводиться все совпадения;
  - совпадение по `nickname` тоже должно попадать в результаты.
- клик по timestamp/time-reference (без рывка scroll и с переходом к target message);
- image preview открывается fullscreen overlay в том же окне;
- mention по `@nickname` и `@Name`;
- PWA install card на mobile UA, включая Telegram in-app UA fallback;
- logout -> редирект на `/login`.

5. Проверка доступа к чужой комнате:
- под третьим пользователем отправить
  `['dialogs:messages', [<roomId>, 100], 'frontend', 'backend', 'req-1']`
- ожидаемый ответ: `{ok:false, error:'forbidden'}`.
