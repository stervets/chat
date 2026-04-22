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
- app room (MVP):
  - `rooms:create` создаёт обычную non-app room (`roomApp.enabled=false`);
  - `rooms:app:configure` переводит комнату в app mode (`roomApp.enabled=true`, `appType` задан);
  - для app room surface должен быть scriptable message (иначе `app_surface_must_be_scriptable`);
  - на фронте виден маркер app room (`subtitle-app`) и app-surface в pinned блоке;
  - изменения app room прилетают realtime-событием `chat:room-updated`;
  - poll/bot-control app-surface синхронизирует shared state между двумя клиентами;
  - после reload/reconnect app-surface и shared state сохраняются.
- graph containers (MVP):
  - из основного `/chat` открыть левый drawer и убедиться, что есть секция `Пространства` (entry point встроен в основной UI);
  - из drawer открыть полный экран spaces (`Весь экран`) или перейти по `/spaces`, создать `space` (например `DeepSeek`);
  - внутри `space` создать `folder` и `room_ref` на существующую комнату;
  - клик по `room_ref` открывает обычную комнату через `/chat?room=<id>&space=<spaceId>&node=<nodeId>`;
  - для app-room через `room_ref` pinned app-surface продолжает работать;
  - в header комнаты, открытой из space, видна кнопка возврата `space · <title>`;
  - reorder children (кнопки вверх/вниз) меняет порядок в контейнере;
  - архивированный node исчезает из списка children;
  - `/chat` (general) и `/direct/:username` остаются рабочими.
- discussion rooms (MVP):
  - в любой non-direct комнате отправить сообщение;
  - нажать `комментарии+` у сообщения;
  - должна создаться discussion room и открыться как обычный `/chat?room=<id>`;
  - в header discussion room должны быть: метка `комментарии` и кнопка `к посту`;
  - `к посту` возвращает в исходную room, по возможности с фокусом на исходный message;
  - повторный клик `комментарии` не создаёт вторую room (переиспользуется существующая связь);
  - второй клиент, находясь в исходной room, получает `chat:message-updated` и видит активную ссылку комментариев;
  - после reload discussion room открывается корректно и не теряет состояние.
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

## Graph headless сценарий

Минимальный e2e-сценарий (Playwright + WS setup) должен покрывать:
1. `lisov` из основного `/chat` открывает `Пространства` в drawer.
2. `lisov` создаёт `space/folder/room_ref`.
3. Переход `space -> room_ref -> chat` работает через стандартный room route-flow.
4. В обычной room отправка сообщения через открытие из graph работает.
5. В app-room (через `room_ref`) pinned scriptable surface активен и виден app marker.
6. Второй клиент (`marx`) видит то же состояние app-surface.
7. После reload/reconnect app-surface не ломается.

## Discussion headless сценарий

Минимальный e2e-сценарий (Playwright + WS setup) должен покрывать:
1. `lisov` создаёт сообщение в обычной room.
2. `lisov` нажимает `комментарии+` и попадает в discussion room.
3. В discussion room отправка сообщений работает.
4. Повторное открытие комментариев для того же post не создаёт новую room.
5. `marx` видит discussion room и может писать в неё.
6. Кнопка `к посту` возвращает в исходную room.
7. Reload в discussion room не ломает открытие и header-метки discussion.
