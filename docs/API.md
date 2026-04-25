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
- `auth:updateProfile({name?, info?, nicknameColor?, avatarPath?, pushDisableAllMentions?})`
- `auth:changePassword({newPassword})`
- `user:list({})`
- `user:get({userId? , nickname?})`

Public user payload:

```ts
{
  id: number,
  nickname: string,
  name: string,
  info: string | null,
  avatarUrl: string | null,
  nicknameColor: string | null,
  donationBadgeUntil: string | null,
  pushDisableAllMentions: boolean,
}
```

HTTP `upload/*` и `push/*` требуют `Authorization: Bearer <token>`.

## Contacts

- `contacts:list({})`
- `contacts:add({userId})`
- `contacts:remove({userId})`

## Rooms

- `room:group:get-default({})`
- `room:list({kind:'direct'})`
- `room:list({kind:'group', scope?:'joined'|'public'|'all'})`
- `room:direct:get-or-create({userId})`
- `room:get({roomId, subscribe?})`
- `room:create({title?, visibility?, commentsEnabled?, avatarPath?, postOnlyByAdmin?})`
- `room:join({roomId})`
- `room:leave({roomId})`
- `room:members:list({roomId})`
- `room:members:add({roomId, userIds})`
- `room:members:remove({roomId, userIds})`
- `room:settings:update({roomId, title?, visibility?, commentsEnabled?, avatarPath?, postOnlyByAdmin?})`
- `room:delete({roomId, confirm:true})`
- `room:surface:set({roomId, roomSurface})`
- `room:pin:set({roomId, nodeId})`
- `room:pin:clear({roomId})`
- `room:runtime:get({roomId})`

Room payload дополнительно содержит:

```ts
{
  joined?: boolean,
  visibility: 'public' | 'private',
  commentsEnabled: boolean,
  avatarUrl: string | null,
  postOnlyByAdmin: boolean,
}
```

`room:members:list` дополнительно отдаёт `isOnline:boolean`.

Семантика:
- `room:group:get-default` может создать default room, но не создаёт membership в `room_users`; поле `joined` отражает фактическое членство.
- `room:delete` для `group/game/comment` удаляет room по текущим правам доступа.
- `room:delete` для `direct` не удаляет комнату: очищает сообщения для обоих участников, сбрасывает `pinnedNodeId`, оставляет room и участников.
- direct clear может выполнить любой участник direct.
- после direct clear backend рассылает `room:messages:cleared({roomId, dialogId, kind:'direct'})`.

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
- если у source room `commentsEnabled === false`, `message:comment-room:create` вернёт `{ok:false,error:'comments_disabled'}`.
- если у room `postOnlyByAdmin === true`, не-админ получит `{ok:false,error:'room_posting_restricted'}`.
- `room:pin:set|clear` для `direct` возвращает `{ok:false,error:'forbidden'}`.

## Runtime

- `runtime:action({nodeType, nodeId, actionType, payload?})`

Runtime сейчас временно выключен:
- `message:create({kind:'scriptable'})` -> `{ok:false,error:'scriptable_disabled'}`
- `runtime:action(...)` -> `{ok:false,error:'scriptable_disabled'}`
- `room:surface:set(...)` -> `{ok:false,error:'scriptable_disabled'}`
- `room:runtime:get(...)` -> `{ok:true, roomRuntime:null}`

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

## Invites

- `invites:create({roomIds?: number[]})`
- `invites:list({})`
- `invites:delete({inviteId})`
- `invites:check({code})`
- `invites:redeem({code, nickname?, password?, name?})`
- `invites:available-rooms({})`

Invite payload теперь может включать:

```ts
{
  rooms: Array<{
    roomId: number,
    title: string,
    visibility: 'public' | 'private',
  }>
}
```

Правила:
- в invite можно включать только joined `group` комнаты;
- `direct` и `comment` комнаты недопустимы;
- после успешного redeem invite удаляется;
- `invites:create({})` сохраняет legacy fallback: invite может быть привязан к fallback/default group room.
- `invites:create({roomIds:[]})` создаёт invite без `invites_rooms`.
- `invites:create({roomIds:[id...]})` привязывает только доступные creator'у `group` комнаты, иначе `invalid_rooms`.
- при redeem пользователь добавляется в комнаты из invite + в системную комнату `Новости MARX`/`MARX` (если существует).
- explicit empty invite (`roomIds:[]`) не добавляет пользователя в `Общий чат`.
- если `invites:redeem` вызвал уже авторизованный пользователь, invite не регистрирует нового юзера, а просто добавляет доступ к room из invite (`appliedToExistingUser=true`, `addedRoomIds[]`).

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
- `room:messages:cleared`
- `room:pin:updated`
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
- `commentCount`
- `runtime: {clientScript, serverScript, data}`
- `commentRoomId`
- `createdAt`
- `reactions[]`

Анонимная отправка:
- в БД `messages.sender_id = id` системного пользователя `anonymous` (не `NULL`);
- в payload: `authorId = <id anonymous>`, `authorNickname = 'anonymous'`, `authorName = 'Аноним'`.
- поддерживается в `group`, `direct`, `game`, `comment` комнатах.

Ошибки: `{ok:false, error:'...'}`.

Legacy `scriptable` сообщения backend всё ещё может вернуть из истории, но frontend должен показывать их как обычный fallback-text без активного runtime.

## HTTP

### Uploads

- `POST /upload/image`
- `POST /upload/media`
- `GET /uploads/:name`

`POST /upload/media`:
- принимает `image/*` и `video/*`;
- картинки на клиенте всегда пережимаются под `max 1024x1024` (aspect ratio сохраняется);
- видео не перекодируется и не сжимается;
- лимит image = `config.uploads.maxBytes`;
- лимит video = `config.uploads.videoMaxBytes` или fallback `50MB`.
- тот же endpoint используется для аватаров room/user (только image на клиенте) и обычных media-сообщений.
- для avatar в `/console` перед upload есть crop UI (круглая маска + drag/zoom), результат отправляется как квадрат `1024x1024`.

### Push

- `GET /push/public-key`
- `POST /push/subscribe`
- `POST /push/unsubscribe`
- `POST /push/test`
