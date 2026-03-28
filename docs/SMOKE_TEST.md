# Smoke Test

## 1. Запуск Postgres

```bash
cd /var/home/lisov/projects/chat/deploy
podman compose up -d postgres
```

## 2. Запуск backend

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

## 3. Запуск frontend

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

## 4. Создание invite через CLI

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

## 5. Регистрация двух пользователей

- Открой `http://localhost:8815/invite/<code>` в обычном браузере, зарегистрируй пользователя.
- Открой второе окно (инкогнито) и зарегистрируй второго пользователя по другому инвайту.

## 6. Проверка /invites

- В первом окне открой `/invites`.
- Нажми `Создать инвайт`.
- Новый код должен появиться в списке.

## 7. Проверка общего чата

- В обоих окнах открой `/chat`.
- Отправь сообщение в «Общий чат» из первого окна.
- Убедись, что оно появилось во втором окне (WS доставка).

## 8. Проверка приватки

- В первом окне выбери пользователя из списка.
- Отправь сообщение.
- Во втором окне открой диалог с первым пользователем и проверь доставку.

## 9. Проверка logout

- Нажми `Выйти` в заголовке чата.
- Должен произойти редирект на `/login`.
- Повторно открыв `/chat`, должен быть редирект на `/login`.

## 10. Проверка доступа к чужому dialogId

- Возьми `dialogId` приватного диалога пользователя A и B.
- Зайди под третьим пользователем и попробуй открыть:

```bash
curl -i -s \
  -b "marx_session=<SESSION>" \
  "http://localhost:8816/api/dialogs/<dialogId>/messages"
```

Ожидается `403 forbidden`.
