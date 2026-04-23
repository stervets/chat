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

Исторический префикс `dialogs:*` сохранён, но модель полностью room-based.

- `dialogs:general([])` -> `{roomId, dialogId, type:'group', title, createdById, pinnedNodeId, roomSurface}`
- `dialogs:private([userId])` -> `{roomId, dialogId, type:'direct', targetUser, createdById:null, pinnedNodeId:null, roomSurface}`
- `dialogs:directs([])` -> `[{roomId, dialogId, targetUser, lastMessageAt, createdById:null, pinnedNodeId:null, roomSurface}]`
- `dialogs:messages([roomId, limit?, beforeMessageId?])` -> `Message[]`
- `chat:join([roomId])` -> `{ok:true, roomId, dialogId, kind, createdById, roomRuntime, roomSurface, discussion, pinnedNodeId, pinnedMessage}`
- `dialogs:delete([roomId, {confirm:true}])` -> `{ok:true, changed, roomId, dialogId, kind}`
- `rooms:create([{title?}])` -> `{ok:true, roomId, dialogId, kind:'group', title, createdById, pinnedNodeId:null, roomSurface}`
- `rooms:surface:configure([roomId, payload])` -> `{ok:true, roomId, dialogId, kind, createdById, roomSurface, roomRuntime, pinnedNodeId, pinnedMessage}`

Сообщения:

- `chat:send([roomId, body, {anonymous?, silent?}?])`
- `chat:edit([messageId, body])`
- `chat:delete([messageId])`
- `chat:pin([roomId, messageId])`
- `chat:unpin([roomId])`
- `chat:react([messageId, emoji|null])`

Комментарии:

- `messages:discussion:get([messageId])` -> `{ok:true, messageId, commentRoomId|null}`
- `messages:discussion:create([messageId])` -> `{ok:true, created, messageId, sourceRoomId, commentRoomId, message}`

Важно:

- `commentRoomId` — id comment room-node (`rooms.kind='comment'`), дочерней к message-node;
- `messages.room_id` и `messages.discussion_room_id` в БД отсутствуют;
- pinned хранится в `rooms.pinned_node_id`, наружу отдаётся как `pinnedNodeId`.

## Scriptable

- `scripts:create-message([roomId, payload])` -> `{ok:true, message}`
- `scripts:action([{nodeType, nodeId, actionType, payload?}])` -> `{ok:true, roomId, nodeType, nodeId, state}`
- `scripts:room:get([roomId])` -> `{ok:true, roomId, roomRuntime|null}`

Runtime snapshot в payload:

```ts
{
  nodeType: 'message' | 'room',
  nodeId: number,
  roomId: number,
  clientScript: string | null,
  serverScript: string | null,
  data: Record<string, any>
}
```

## Games

- `games:solo:create([{moduleKey:'king'}])`
- `games:session:get([sessionId])`
- `games:action([{sessionId, action}])`

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
- `runtime: {clientScript, serverScript, data}`
- `commentRoomId`
- `createdAt`
- `reactions[]`

Анонимная отправка:

- в БД `messages.sender_id = NULL`;
- в payload: `authorId = 0`, `authorNickname = 'anonymous'`, `authorName = 'Аноним'`.

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
