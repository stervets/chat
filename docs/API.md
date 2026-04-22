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
- `auth:me([])` -> `{id, nickname, name, nicknameColor, donationBadgeUntil, pushDisableAllMentions}`
- `auth:logout([])` -> `{ok:true}`
- `auth:updateProfile([{name?, nicknameColor?, pushDisableAllMentions?}])` -> `{ok:true, user}`
- `auth:changePassword([{newPassword}])` -> `{ok:true}`

### Users
- `users:list([])` -> `User[]`
- `users.name` не уникален: в выдаче могут быть несколько пользователей с одинаковым `name`.

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

- `dialogs:general([])` -> `{roomId, dialogId, type:'group', title, createdById, pinnedMessageId, roomApp}`
- `dialogs:private([userId])` -> `{roomId, dialogId, type:'direct', targetUser, createdById:null, pinnedMessageId:null, roomApp}`
- `dialogs:directs([])` -> `[{roomId, dialogId, targetUser, lastMessageAt, createdById:null, pinnedMessageId:null, roomApp}]`
- `dialogs:messages([roomId, limit?, beforeMessageId?])` -> `Message[]` (старые -> новые)
- `chat:join([roomId])` -> `{ok:true, roomId, dialogId, kind, createdById, roomScript, roomApp, discussion, pinnedMessageId, pinnedMessage}`
- `dialogs:delete([roomId, {confirm:true}])` -> `{ok:true, changed, roomId, dialogId, kind}`
- `rooms:create([{title?}])` -> `{ok:true, roomId, dialogId, kind:'group', title, createdById, pinnedMessageId:null, roomApp}`
- `rooms:app:configure([roomId, payload])` -> `{ok:true, roomId, dialogId, kind, createdById, roomApp, roomScript, pinnedMessageId, pinnedMessage}`

- `chat:send([roomId, body, {anonymous?, silent?}?])` -> `{ok:true, message}`
- `chat:edit([messageId, body])` -> `{ok:true, changed, message}`
- `chat:delete([messageId])` -> `{ok:true, changed, roomId, dialogId, messageId, pinnedCleared}`
- `chat:pin([roomId, messageId])` -> `{ok:true, changed, roomId, dialogId, pinnedMessageId, pinnedMessage}`
- `chat:unpin([roomId])` -> `{ok:true, changed, roomId, dialogId, pinnedMessageId:null, pinnedMessage:null}`
- `chat:react([messageId, emoji|null])` -> `{ok:true, changed, roomId, dialogId, messageId, reactions, notify}`
- `messages:discussion:get([messageId])` -> `{ok:true, messageId, discussionRoomId|null}`
- `messages:discussion:create([messageId])` -> `{ok:true, created, messageId, sourceRoomId, discussionRoomId, message}`

Ограничения:
- `chat:pin/chat:unpin` работают только в не-direct комнатах и только для админа комнаты (`rooms.created_by`).
- В direct закрепы отключены (`pinnedMessageId/pinnedMessage` всегда `null`).
- `chat:pin` принимает message любого `kind` (`text | system | scriptable`), но message обязан принадлежать той же комнате.
- если `roomApp.enabled=true`, закреп для app-surface допускает только `scriptable` (`app_surface_must_be_scriptable`).
- если pinned message удалён, `rooms.pinned_message_id` сбрасывается (`ON DELETE SET NULL`), а клиенты получают `chat:pinned` c `null`.
- discussion room:
  - один message может иметь одну discussion room (`messages.discussion_room_id`);
  - discussion room создаётся как обычная `room(kind='group')`;
  - удаление discussion room сбрасывает `messages.discussion_room_id` через FK `ON DELETE SET NULL`;
  - удаление исходного message не удаляет discussion room.
- `dialogs:delete` требует явный `confirm:true`.
  - `direct` может удалить любой участник;
  - `group/game` может удалить только админ комнаты.

### Graph Containers (MVP)
- `graph:spaces:list([])` -> `GraphNode[]` (`kind='space'`)
- `graph:children([parentNodeId])` -> `GraphNode[]` (children `folder|room_ref`)
- `graph:space:create([{title?, pathSegment?, config?}])` -> `{ok:true, node}`
- `graph:folder:create([{parentNodeId, title?, pathSegment?, config?}])` -> `{ok:true, node}`
- `graph:room-ref:create([{parentNodeId, roomId, title?, pathSegment?, config?}])` -> `{ok:true, node}`
- `graph:children:reorder([{parentNodeId, childNodeIds[]}])` -> `{ok:true, children}`
- `graph:node:archive([nodeId])` -> `{ok:true, nodeId, archived}`
- `graph:rooms:list([])` -> `[{id, kind, title, createdById, appEnabled, appType, pinnedMessageId}]` (только доступные текущему пользователю комнаты)

Ограничения graph-layer:
- поддерживаются только `graph_nodes.kind = space | folder | room_ref`;
- `room_ref` работает только с `targetType='room'`;
- `message-ref` на этом этапе отсутствует и запрещён;
- graph-layer не хранит сообщения и не заменяет `rooms/messages`;
- при удалении комнаты связанные `room_ref` архивируются (`graph:children` больше их не возвращает).

### Frontend routing contract (spaces + chat)

- базовый чатовый маршрут не меняется: `/chat` и `/direct/:username`.
- `room_ref` открывает комнату через тот же `/chat` c query:
  - `room` — id комнаты (обязательно для room open),
  - `space` — id space-источника (опционально, для UX-контекста),
  - `node` — id `room_ref` node (опционально, для UX-контекста).
- `space/node` query не влияет на backend `chat:join` и не создаёт второй route-flow; это только клиентский навигационный контекст.

### Scriptable
- `scripts:create-message([roomId, payload])` -> `{ok:true, message}`
- `scripts:action([{entityType, entityId, actionType, payload?}])` -> `{ok:true, roomId, entityType, entityId, state}`
- `scripts:room:get([roomId])` -> `{ok:true, roomId, roomScript|null}`
- runtime identity фиксирован по entity id (`message:<id>`, `room:<id>`): для pinned message второй runtime не создаётся.
- lifecycle в клиентском runtime: `init -> mount -> update -> unmount` (детально: `docs/SCRIPTABLE_CONCEPT.md`).
- unified runtime event envelope: `{source:'ui'|'room'|'server'|'system', type, payload}` (детально: `docs/SCRIPTABLE_API.md`).
- успешный `scripts:action` дополнительно прокидывается в room runtime как room-event `script_action` (через текущий room-event pipeline).

### RoomApp payload

`roomApp` приходит в `dialogs:*`, `chat:join`, `chat:room-updated`:

```json
{
  "enabled": false,
  "appType": null,
  "config": {},
  "surfaceMessageId": null,
  "surfaceKind": null,
  "hasRoomRuntime": false,
  "requiresRoomRuntime": false,
  "canCollapseSurface": true
}
```

`appType`: `llm | poll | dashboard | bot_control | custom`.

### Discussion payload

`discussion` приходит в `chat:join` только для discussion rooms:

```json
{
  "sourceMessageId": 42,
  "sourceRoomId": 7,
  "sourceRoomKind": "group",
  "sourceRoomTitle": "Новости",
  "sourceMessagePreview": "Текст исходного поста...",
  "sourceMessageDeleted": false
}
```

Если исходный message удалён, `sourceMessageDeleted=true`, а `sourceRoomId/sourceRoomKind` могут быть `null`.

### GraphNode payload

`graph:*` команды возвращают node в формате:

```json
{
  "id": 10,
  "kind": "room_ref",
  "title": "DeepSeek main",
  "pathSegment": null,
  "targetType": "room",
  "targetId": 123,
  "config": {},
  "parentNodeId": 7,
  "sortOrder": 2,
  "room": {
    "id": 123,
    "kind": "group",
    "title": "DeepSeek",
    "createdById": 1,
    "appEnabled": true,
    "appType": "llm",
    "pinnedMessageId": 456
  }
}
```

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
- `chat:pinned` -> `[{roomId, dialogId, pinnedMessageId, pinnedMessage}]`
- `chat:room-updated` -> `[{roomId, dialogId, kind, createdById, roomApp, roomScript, pinnedMessageId}]`
- `chat:reactions` -> `[{roomId, dialogId, messageId, reactions}]`
- `chat:reaction-notify` -> `[payload]`
- `dialogs:deleted` -> `[{roomId, dialogId, kind}]`
- `users:updated` -> `[user]`
- `scripts:state` -> `[{roomId, entityType, entityId, scriptId, scriptRevision, scriptMode, scriptStateJson}]`

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
- `kind` (`text | system | scriptable`)
- `scriptId`, `scriptRevision`, `scriptMode`, `scriptConfigJson`, `scriptStateJson`
- `discussionRoomId` (`number | null`)
- `createdAt`
- `reactions[]`

Особенность:
- для анонимного сообщения `messages.sender_id = NULL`, а в payload приходит
  `authorId = 0`, `authorNickname = 'anonymous'`, `authorName = 'Аноним'`, `authorNicknameColor = null`.

Ошибки команд: `{ok:false, error:'...'}`.

## Push правила

- Для `room.kind='direct'` push отправляется только собеседнику, не отправителю.
- Для `room.kind='group'` push идёт только по mention (`@nickname`/`@Name`) или `@all`.
- Флаг пользователя `pushDisableAllMentions=true` отключает только push от `@all`.
- Прямой mention (`@nickname`/`@Name`) продолжает работать даже при отключенном `@all`.

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
  - локальный fallback: если push backend не инициализирован, endpoint возвращает disabled-конфиг вместо exception (`{ok:true, enabled:false, vapidPublicKey:''}`)
- `POST /push/subscribe`
  - auth required
  - body: PushSubscription
- `POST /push/unsubscribe`
  - auth required
  - body: `{endpoint}`
- `POST /push/test`
  - auth required
  - отправка тестового push для текущего пользователя
