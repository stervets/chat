# API

Основной транспорт: WebSocket (`ws://<backend-host>:8816/ws`).
HTTP используется для upload и web-push.

## Auth модель

- JWT нет.
- Cookie-session нет.
- Session token выдаётся в `auth:login`/`invites:redeem`.
- Клиент хранит токен в `localStorage['marx_session_token']`.
- Восстановление сессии: `auth:session(token)`.
- HTTP `upload/*` и `push/*` требуют `Authorization: Bearer <token>`.

## Формат WS пакета

Клиент -> сервер:
```json
["command", [arg1, arg2], "frontend", "backend", "requestId"]
```

Сервер -> клиент (response):
```json
["[res]", [result], "backend", "frontend", "requestId"]
```

Сервер -> клиент (event):
```json
["event:name", [payload], "backend", "<socket-id>"]
```

## WS Команды

### Auth
- `auth:login([{nickname, password}])` -> `{ok:true, token, expiresAt, user}`
- `auth:session([token])` -> `{ok:true, token, expiresAt, user}`
- `auth:me([])` -> `{id, nickname, name, nicknameColor, donationBadgeUntil}`
- `auth:logout([])` -> `{ok:true}`
- `auth:updateProfile([{name?, nicknameColor?}])` -> `{ok:true, user}`
- `auth:changePassword([{newPassword}])` -> `{ok:true}`

### Users
- `users:list([])` -> `User[]`

### Invites / VPN
- `invites:list([])` -> `Invite[]`
- `invites:create([])` -> `{id, code, createdAt}`
- `invites:check([{code}])` -> `{ok:true, code}`
- `invites:redeem([{code, nickname, password, name?}])` -> `{ok:true, token, expiresAt, user}`
- `public:vpnInfo([])` -> `{ok:true, donationPhone, donationBank}`
- `public:vpnProvision([])` -> `{ok:true, link, configText, qrText}`
- `public:vpnDonation([{sent:boolean}])` -> `{ok:true, user}`

### Chat / Rooms

Важно: имена команд старые (`dialogs:*`), но объектная модель уже room-based.

- `dialogs:general([])` -> `{roomId, dialogId, type:'group', title}`
- `dialogs:private([userId])` -> `{roomId, dialogId, type:'direct', targetUser}`
- `dialogs:directs([])` -> `[{roomId, dialogId, targetUser, lastMessageAt}]`
- `dialogs:messages([roomId, limit?, beforeMessageId?])` -> `Message[]` (старые -> новые)
- `chat:join([roomId])` -> `{ok:true, roomId, dialogId}`
- `dialogs:delete([roomId])` -> `{ok:true, changed, roomId, dialogId, kind:'direct'}`

- `chat:send([roomId, body, {silent?}?])` -> `{ok:true, message}`
- `chat:edit([messageId, body])` -> `{ok:true, changed, message}`
- `chat:delete([messageId])` -> `{ok:true, changed, roomId, dialogId, messageId}`
- `chat:react([messageId, emoji|null])` -> `{ok:true, changed, roomId, dialogId, messageId, reactions, notify}`

### Games
- `games:solo:create([{moduleKey:'king'}])` -> `{ok:true, roomId, sessionId, session, messages, events}`
- `games:session:get([sessionId])` -> `{ok:true, roomId, sessionId, session}`
- `games:action([{sessionId, action}])` -> `{ok:true, roomId, sessionId, session, events, messages}`

`action` сейчас поддерживается только `play_card`:
```json
{"type":"play_card","payload":{"suit":"hearts","rank":"Q"}}
```

## WS Events

### Chat
- `chat:message` -> `[message]`
- `chat:message-updated` -> `[message]`
- `chat:message-deleted` -> `[{roomId, dialogId, messageId}]`
- `chat:reactions` -> `[{roomId, dialogId, messageId, reactions}]`
- `chat:reaction-notify` -> `[payload]`
- `dialogs:deleted` -> `[{roomId, dialogId, kind}]`
- `users:updated` -> `[user]`

### Games
- `games:session` -> `[sessionPayload]`
- `games:event` -> `[{sessionId, event}]`
- `games:state` -> `[{sessionId, state, actions, status}]`

### Front runtime events (client-side)
- `ws:connected`
- `ws:disconnected`
- `ws:reconnected`
- `ws:session-expired`

## Тип `Message`

Минимальные поля:
- `id`
- `roomId` (+ alias `dialogId`)
- `authorId`, `authorNickname`, `authorName`, `authorNicknameColor`, `authorDonationBadgeUntil`
- `rawText`
- `renderedHtml`
- `renderedPreviews[]`
- `createdAt`
- `reactions[]`

Ошибки команд: `{ok:false, error:'...'}`.

## HTTP API

### Uploads
- `POST /upload/image`
  - auth: `Authorization: Bearer <session_token>`
  - multipart field: `file`
  - только `image/*`, проверяется размер
  - response: `{ok:true, path, url, mime, size, uploadedBy}`
- `GET /uploads/:name`
  - возвращает файл

### Push
- `GET /push/public-key`
  - response: `{ok:true, enabled, vapidPublicKey}`
- `POST /push/subscribe`
  - auth required
  - body: PushSubscription
- `POST /push/unsubscribe`
  - auth required
  - body: `{endpoint}`
- `POST /push/test`
  - auth required
  - отправка тестового push для текущего пользователя
