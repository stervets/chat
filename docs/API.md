# API

Основной транспорт: WebSocket (`ws://<backend-host>:8816/ws`).
HTTP используется только для upload/download файлов.

## Auth модель

- JWT нет.
- Cookie-session нет.
- Session token выдаётся в `auth:login` и `invites:redeem`.
- Клиент хранит token в `localStorage` (`marx_session_token`).
- Восстановление сессии: WS-команда `auth:session`.
- Upload использует `Authorization: Bearer <token>`.
- `nickname` всегда приводится к lowercase.
- Регистронезависимость: `USER` и `user` — один пользователь.
- Валидный формат nickname: `^[a-z0-9_-]{3,32}$`.

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

## Команды (WS)

- `auth:login` args: `[{nickname, password}]`
  success: `{ok:true, token, expiresAt, user}`
- `auth:session` args: `[token]`
  success: `{ok:true, token, expiresAt, user}`
- `auth:me` args: `[]`
  success: `{id, nickname, name, nicknameColor, donationBadgeUntil}`
- `auth:logout` args: `[]`
  success: `{ok:true}`
- `auth:updateProfile` args: `[{name?, nicknameColor?}]`
  success: `{ok:true, user}`
- `auth:changePassword` args: `[{newPassword}]`
  success: `{ok:true}`

- `users:list` args: `[]`
  success: `User[]`

- `invites:list` args: `[]`
  success: `Invite[]`
- `invites:create` args: `[]`
  success: `{id, code, createdAt}`
- `invites:check` args: `[{code}]`
  success: `{ok:true, code}`
- `invites:redeem` args: `[{code, nickname, password, name?}]`
  success: `{ok:true, token, expiresAt, user}`
- `public:vpnInfo` args: `[]`
  success: `{ok:true, donationPhone, donationBank}`
- `public:vpnDonation` args: `[{sent:boolean}]`
  success: `{ok:true, user}`

- `dialogs:general` args: `[]`
  success: `{dialogId, type:'general', title}`
- `dialogs:private` args: `[userId]`
  success: `{dialogId, type:'private', targetUser}`
- `dialogs:directs` args: `[]`
  success: `[{dialogId, targetUser, lastMessageAt}]`
- `dialogs:messages` args: `[dialogId, limit?, beforeMessageId?]`
  success: `Message[]` (в порядке старые → новые)
- `dialogs:delete` args: `[dialogId]`
  success: `{ok:true, changed, dialogId, kind:'private'}`

- `chat:join` args: `[dialogId]`
  success: `{ok:true, dialogId}`
- `chat:send` args: `[dialogId, body]`
  success: `{ok:true, message}`
- `chat:edit` args: `[messageId, body]`
  success: `{ok:true, changed, message}`
- `chat:delete` args: `[messageId]`
  success: `{ok:true, changed, dialogId, messageId}`
- `chat:react` args: `[messageId, emoji | null]`
  success: `{ok:true, changed, dialogId, messageId, reactions, notify?}`

`Message` содержит минимум:
- `id`, `dialogId`, `authorId`, `authorNickname`, `authorName`, `authorNicknameColor`, `authorDonationBadgeUntil`
- `rawText` (исходник для редактирования)
- `renderedHtml` (серверно скомпилированный безопасный HTML для рендера)
- `createdAt`, `reactions[]`

Ошибки команд возвращаются в виде `{ok:false, error:'...'}`.

## Push-события

- `chat:message` args: `[message]`
- `chat:message-updated` args: `[message]`
- `chat:message-deleted` args: `[{dialogId, messageId}]`
- `chat:reactions` args: `[{dialogId, messageId, reactions}]`
- `chat:reaction-notify` args: `[payload]`
- `dialogs:deleted` args: `[{dialogId, kind}]`
- `users:updated` args: `[user]`
- `ws:connected` / `ws:disconnected` на фронте пробрасываются через event-bus клиентом.

## HTTP upload/download

- `POST /upload/image`
  - auth: `Authorization: Bearer <session_token>`
  - multipart field: `file`
  - принимает только `image/*`, проверяет размер
  - success: `{ok:true, path, url, mime, size, uploadedBy}`
- `GET /uploads/:name`
  - отдаёт ранее загруженный файл
