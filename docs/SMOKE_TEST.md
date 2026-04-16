# Smoke Test

SQLite файл создаётся автоматически при запуске backend.

## Быстрый smoke (headless)

Требуется установленный Playwright:

```bash
cd /var/home/lisov/projects/chat
yarn install
npx playwright install chromium
```

Запуск:

```bash
yarn run smoke
```

Сценарий делает:
1. Сброс БД.
2. Создание первого пользователя через `user:bootstrap`.
3. Запуск backend и frontend.
4. Логин, создание инвайта, регистрация второго пользователя.
5. Проверка обмена сообщениями в общем чате.
6. Проверка приватного диалога между пользователями.

## 1. Запуск backend

```bash
cd /var/home/lisov/projects/chat/backend
yarn install
yarn run dev
```

Или из корня:
```bash
cd /var/home/lisov/projects/chat
yarn run backend:dev
```

## 2. Запуск frontend

```bash
cd /var/home/lisov/projects/chat/frontend
yarn install
yarn run dev
```

Или из корня:
```bash
cd /var/home/lisov/projects/chat
yarn run frontend:dev
```

## 3. Создание invite через CLI

```bash
cd /var/home/lisov/projects/chat/backend
yarn run invite:create
```

Несколько инвайтов:
```bash
yarn run invite:create -- --count 5
```

Или из корня:
```bash
cd /var/home/lisov/projects/chat
yarn run invite:create
```

## 4. Регистрация двух пользователей

- Открой `http://localhost:8815/invite/<code>` в обычном браузере, зарегистрируй пользователя.
- Открой второе окно (инкогнито) и зарегистрируй второго пользователя по другому инвайту.

## 5. Проверка /invites

- В первом окне открой `/invites`.
- Нажми `Создать инвайт`.
- Новый код должен появиться в списке.

## 6. Проверка общего чата

- В обоих окнах открой `/chat`.
- Отправь сообщение в «Общий чат» из первого окна.
- Убедись, что оно появилось во втором окне (WS доставка).

## 7. Проверка приватки

- В первом окне выбери пользователя из списка.
- Отправь сообщение.
- Во втором окне открой диалог с первым пользователем и проверь доставку.

## 8. Проверка logout

- Нажми `Выйти` в заголовке чата.
- Должен произойти редирект на `/login`.
- Повторно открыв `/chat`, должен быть редирект на `/login`.

## 9. Проверка доступа к чужому dialogId

- Возьми `dialogId` приватного диалога пользователя A и B.
- Зайди под третьим пользователем и отправь WS запрос:
  - `["dialogs:messages",[<dialogId>,100],"frontend","backend","req-1"]`
- Ожидается ответ:
  - `["[res]",[{"ok":false,"error":"forbidden"}],"backend","frontend","req-1"]`
