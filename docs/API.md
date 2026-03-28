# API

Базовый набор эндпоинтов для минимальной системы auth/invites/sessions/чат.

## Auth

### POST `/api/auth/login`
Body:
```json
{
  "nickname": "user",
  "password": "secret"
}
```
Ответ: `200 OK`, выставляет httpOnly cookie.

### POST `/api/auth/change-password`
Auth required.

Body:
```json
{
  "oldPassword": "old",
  "newPassword": "new"
}
```

### GET `/api/me`
Auth required.

Ответ:
```json
{
  "id": 1,
  "nickname": "user"
}
```

### POST `/api/auth/logout`
Auth required.

Ответ:
```json
{
  "ok": true
}
```

## Users

### GET `/api/users`
Auth required.

Ответ:
```json
[
  {"id": 2, "nickname": "user2"}
]
```

## Invites

### GET `/api/invites`
Auth required.

Ответ:
```json
[
  {
    "id": 10,
    "code": "abcd1234",
    "createdAt": "2026-03-27T10:00:00.000Z",
    "usedAt": null,
    "usedBy": null,
    "isUsed": false
  }
]
```

### POST `/api/invites/create`
Auth required.

Ответ:
```json
{
  "id": 10,
  "code": "abcd1234",
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

### POST `/api/invites/redeem`
Body:
```json
{
  "code": "abcd1234",
  "nickname": "user",
  "password": "secret"
}
```
Ответ: `200 OK`, выставляет cookie.

## Dialogs

### GET `/api/dialogs/general`
Auth required.

Ответ:
```json
{
  "dialogId": 1,
  "type": "general",
  "title": "Общий чат"
}
```

### POST `/api/dialogs/private/:userId`
Auth required.

Ответ:
```json
{
  "dialogId": 10,
  "type": "private",
  "targetUser": {"id": 2, "nickname": "user2"}
}
```

### GET `/api/dialogs/:dialogId/messages?limit=100`
Auth required.

Ответ:
```json
[
  {
    "id": 1,
    "dialogId": 10,
    "authorId": 2,
    "authorNickname": "user2",
    "body": "hello",
    "createdAt": "2026-03-27T10:00:00.000Z"
  }
]
```

## WebSocket

Подключение: `ws://localhost:8816/ws` (cookie session обязателен)

### client → server

- `chat:join`
```json
{"type":"chat:join","payload":{"dialogId":1}}
```

- `chat:send`
```json
{"type":"chat:send","payload":{"dialogId":1,"body":"hello"}}
```

### server → client

- `chat:message`
```json
{"type":"chat:message","payload":{"id":1,"dialogId":1,"authorId":1,"authorNickname":"user","body":"hello","createdAt":"..."}}
```

- `chat:error`
```json
{"type":"chat:error","payload":{"message":"forbidden"}}
```
