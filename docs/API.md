# API

Основной транспорт: WebSocket (`ws://<backend-host>:8816/ws`).
HTTP остаётся для upload и web-push.

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

## Auth

- `auth:login([{nickname, password}])`
- `auth:session([token])`
- `auth:me([])`
- `auth:logout([])`
- `auth:updateProfile([{name?, nicknameColor?, pushDisableAllMentions?}])`
- `auth:changePassword([{newPassword}])`

HTTP `upload/*` и `push/*` требуют `Authorization: Bearer <token>`.

## Chat / Rooms

Исторический префикс `dialogs:*` остался, но модель теперь целиком room-based.

- `dialogs:general([])` -> `{roomId, dialogId, type:'group', title, createdById, pinnedMessageId, roomApp}`
- `dialogs:private([userId])` -> `{roomId, dialogId, type:'direct', targetUser, createdById:null, pinnedMessageId:null, roomApp}`
- `dialogs:directs([])` -> `[{roomId, dialogId, targetUser, lastMessageAt, createdById:null, pinnedMessageId:null, roomApp}]`
- `dialogs:messages([roomId, limit?, beforeMessageId?])` -> `Message[]`
- `chat:join([roomId])` -> `{ok:true, roomId, dialogId, kind, createdById, roomScript, roomApp, discussion, pinnedMessageId, pinnedMessage}`
- `dialogs:delete([roomId, {confirm:true}])` -> `{ok:true, changed, roomId, dialogId, kind}`
- `rooms:create([{title?}])` -> `{ok:true, roomId, dialogId, kind:'group', title, createdById, pinnedMessageId:null, roomApp}`
- `rooms:app:configure([roomId, payload])` -> `{ok:true, roomId, dialogId, kind, createdById, roomApp, roomScript, pinnedMessageId, pinnedMessage}`

Сообщения:

- `chat:send([roomId, body, {anonymous?, silent?}?])`
- `chat:edit([messageId, body])`
- `chat:delete([messageId])`
- `chat:pin([roomId, messageId])`
- `chat:unpin([roomId])`
- `chat:react([messageId, emoji|null])`

Комментарии:

- `messages:discussion:get([messageId])` -> `{ok:true, messageId, discussionRoomId|null}`
- `messages:discussion:create([messageId])` -> `{ok:true, created, messageId, sourceRoomId, discussionRoomId, message}`

Важно:

- `discussionRoomId` в payload теперь означает child room-node (`rooms.kind='comment'`) под message-node;
- отдельного `messages.discussion_room_id` в БД больше нет;
- `messages.room_id` в БД больше нет;
- pinned хранится в `rooms.pinned_node_id`, но в payload по-прежнему отдаётся как `pinnedMessageId`, потому что pinned сейчас всегда message-node.

Ограничения:

- `chat:pin/chat:unpin` работают только в non-direct комнате и только для админа комнаты;
- pinned может быть `text | system | scriptable`, если сообщение лежит в этой же комнате;
- если app room включён, surface должен быть `scriptable`;
- `dialogs:delete` требует `confirm:true`;
- `direct` может удалить любой участник, non-direct — только админ.

## Scriptable

- `scripts:create-message([roomId, payload])` -> `{ok:true, message}`
- `scripts:action([{entityType, entityId, actionType, payload?}])` -> `{ok:true, roomId, entityType, entityId, state}`
- `scripts:room:get([roomId])` -> `{ok:true, roomId, roomScript|null}`

Снимок runtime по payload:

- `scriptId`
- `scriptRevision`
- `scriptMode`
- `scriptConfigJson`
- `scriptStateJson`

Хранение в БД при этом идёт через `nodes.client_script`, `nodes.server_script`, `nodes.data`.

## Games

- `games:solo:create([{moduleKey:'king'}])`
- `games:session:get([sessionId])`
- `games:action([{sessionId, action}])`

## Graph / Spaces

`graph:*` команды удалены.

Отдельной graph-модели, spaces/folders/room_ref и graph-state в системе больше нет.

## WS events

- `chat:message`
- `chat:message-updated`
- `chat:message-deleted`
- `chat:pinned`
- `chat:room-updated`
- `chat:reactions`
- `chat:reaction-notify`
- `dialogs:deleted`
- `users:updated`
- `scripts:state`
- `games:*`

## Тип `Message`

Минимальные поля:

- `id`
- `roomId` (+ alias `dialogId`)
- `kind`
- `authorId`, `authorNickname`, `authorName`, `authorNicknameColor`, `authorDonationBadgeUntil`
- `rawText`
- `renderedHtml`
- `renderedPreviews[]`
- `scriptId`, `scriptRevision`, `scriptMode`, `scriptConfigJson`, `scriptStateJson`
- `discussionRoomId`
- `createdAt`
- `reactions[]`

Анонимная отправка:

- в БД `messages.sender_id = NULL`;
- в payload приходит `authorId = 0`, `authorNickname = 'anonymous'`, `authorName = 'Аноним'`.

Ошибки: `{ok:false, error:'...'}`.

## HTTP

### Uploads

- `POST /upload/image`
- `GET /uploads/:name`

### Push

- `GET /push/public-key`
- `POST /push/subscribe`
- `POST /push/unsubscribe`
- `POST /push/test`
