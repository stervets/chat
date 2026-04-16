# API (WebSocket only)

HTTP REST эндпоинтов больше нет. Весь транспорт идёт через `ws://<backend-host>:8816/ws`.

## Формат пакета

Клиент → сервер:
```json
["command", [arg1, arg2], "frontend", "backend", "requestId"]
```

Сервер → клиент (ответ):
```json
["[res]", [result], "backend", "frontend", "requestId"]
```

Сервер → клиент (push-событие):
```json
["chat:message", [payload], "backend", "<client-id>"]
```

## Команды

- `auth:login` args: `[{nickname, password}]`  
  result: `{ok, token?, expiresAt?, user?, error?}`
- `auth:session` args: `[token]`  
  result: `{ok, token?, expiresAt?, user?, error?}`
- `auth:me` args: `[]`  
  result: `{id, nickname}` или `{ok:false,error}`
- `auth:logout` args: `[]`
- `auth:changePassword` args: `[{oldPassword, newPassword}]`

- `users:list` args: `[]`

- `invites:list` args: `[]`
- `invites:create` args: `[]`
- `invites:redeem` args: `[{code, nickname, password}]`

- `dialogs:general` args: `[]`
- `dialogs:private` args: `[userId]`
- `dialogs:messages` args: `[dialogId, limit]`

- `chat:join` args: `[dialogId]`
- `chat:send` args: `[dialogId, body]`

## Push-события

- `chat:message` args: `[message]`
- `ws:connected` / `ws:disconnected` на фронте пробрасываются через event-bus клиентом.
