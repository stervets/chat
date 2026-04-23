# API

Основной транспорт: WebSocket (`ws://<backend-host>:8816/ws`).
HTTP остаётся только для upload и web-push.

## Формат WS пакета

Клиент -> сервер:

```json
["command:name", {"arg":"value"}, "frontend", "backend", "requestId"]
```

Сервер -> клиент, response:

```json
["[res]", [result], "backend", "frontend", "requestId"]
```

Сервер -> клиент, event:

```json
["event:name", {"payload":"value"}, "backend", "<socket-id>"]
```

Правило жёсткое:
- request `args` всегда один объект;
- позиционных аргументов в публичном API нет;
- команды называются только по схеме `entity:action` или `entity:subentity:action`.

## Auth

- `auth:login({nickname, password})`
- `auth:session({token})`
- `auth:me({})`
- `auth:logout({})`
- `auth:updateProfile({name?, nicknameColor?, pushDisableAllMentions?})`
- `auth:changePassword({newPassword})`
- `user:list({})`

HTTP `upload/*` и `push/*` требуют `Authorization: Bearer <token>`.

## Rooms

- `room:group:get-default({})`
- `room:list({kind:'direct'})`
- `room:direct:get-or-create({userId})`
- `room:get({roomId})`
- `room:create({title?})`
- `room:delete({roomId, confirm:true})`
- `room:surface:set({roomId, roomSurface})`
- `room:pin:set({roomId, nodeId})`
- `room:pin:clear({roomId})`
- `room:runtime:get({roomId})`

## Messages

- `message:list({roomId, limit?, beforeMessageId?})`
- `message:create({roomId, kind:'text', text, anonymous?, silent?})`
- `message:create({roomId, kind:'scriptable', clientScript?, serverScript?, data?})`
- `message:update({messageId, text})`
- `message:delete({messageId})`
- `message:reaction:set({messageId, emoji})`
- `message:comment-room:get({messageId})`
- `message:comment-room:create({messageId})`

Важно:
- `commentRoomId` — id comment room-node (`rooms.kind='comment'`), дочерней к message-node;
- `messages.room_id` и `messages.discussion_room_id` в БД отсутствуют;
- pinned хранится в `rooms.pinned_node_id`, наружу отдаётся как `pinnedNodeId`.

## Runtime

- `runtime:action({nodeType, nodeId, actionType, payload?})`

Runtime snapshot:

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

- `game:session:create-solo({moduleKey:'king'})`
- `game:session:get({sessionId})`
- `game:session:action({sessionId, action})`

## WS events

- `message:created`
- `message:updated`
- `message:deleted`
- `message:reactions:updated`
- `message:reaction:notify`
- `room:updated`
- `room:deleted`
- `room:pin:updated`
- `runtime:data:updated`
- `user:updated`
- `game:session:updated`
- `game:event`
- `game:state:updated`

## Тип `Message`

Минимальные поля:
- `id`
- `roomId`
- `dialogId` как UI alias того же room id
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
