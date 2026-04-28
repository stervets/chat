# AGENTS.md

## Проект
`MARX` — закрытый mobile-first чат (PWA):
- комнаты `group | direct | game | comment`;
- игровой модуль `King`;
- scriptable/runtime для `message` и `room` сейчас временно выключен в активном chat flow.

Репа:
- `backend` — NestJS HTTP + WebSocket + Prisma/PostgreSQL;
- `frontend` — Nuxt 3 SPA (`ssr:false`), Vue 3, Tailwind, Less;
- `scripts` — smoke/e2e/stress.

## Каноническая модель данных
- дерево только через `nodes.parent_id`;
- `nodes.type`: `room | message`;
- `rooms.id = nodes.id`;
- `messages.id = nodes.id`;
- `messages` не содержит `room_id`;
- comment room: child room-node под message-node (`rooms.kind='comment'`);
- pinned: `rooms.pinned_node_id -> nodes.id` (сейчас это message-node);
- админ room: `nodes.created_by` room-node (в direct админа нет);
- `messages.sender_id` для анонимной отправки указывает на системного пользователя `anonymous` (не `NULL`).

Scriptable/runtime:
- runtime поля: `nodes.client_script`, `nodes.server_script`, `nodes.data`;
- runtime читает весь `nodes.data` целиком;
- если runtime делит данные на части, используй нейтральные ключи вроде `data.config` и `data.state`, без legacy-терминов;
- room surface: `nodes.data.roomSurface`;
- один runtime на `message:<id>` или `room:<id>`; pinned не создаёт второй runtime.
- важно: поля и старые файлы не выпилены, но `message:create(kind='scriptable')`, `runtime:action`, `room:surface:set` и активные runtime sync/update сейчас отключены.

## WebSocket
Пакет:
```ts
[com, args, senderId, recipientId, requestId?]
```
Ответ:
```ts
['[res]', [result], 'backend', 'frontend', requestId]
```

Основные команды:
- `room:group:get-default`, `room:list`, `room:direct:get-or-create`, `room:get`, `room:create`, `room:join`, `room:leave`, `room:delete`
- `room:members:list`, `room:members:add`, `room:members:remove`, `room:settings:update`
- `room:surface:set`, `room:pin:set`, `room:pin:clear`, `room:runtime:get`
- `message:list`, `message:create`, `message:update`, `message:delete`, `message:reaction:set`
- `message:comment-room:get`, `message:comment-room:create`
- `runtime:action`
- `game:session:create-solo`, `game:session:get`, `game:session:action`
- `user:get`
- `contacts:list`, `contacts:add`, `contacts:remove`
- `invites:available-rooms`, `invites:delete`

Основные events:
- `message:created`, `message:updated`, `message:deleted`
- `message:reactions:updated`, `message:reaction:notify`
- `room:updated`, `room:deleted`, `room:pin:updated`
- `user:updated`
- `game:session:updated`, `game:event`, `game:state:updated`

## Ключевые entry points
Backend:
- `backend/src/main.ts`
- `backend/src/app.module.ts`
- `backend/src/ws/chat.gateway.ts`
- `backend/src/ws/chat.domain.ts`
- `backend/src/ws/chat.commands.ts`
- `backend/src/ws/chat/chat-context*.ts`
- `backend/src/db.ts`
- `backend/prisma/schema.prisma`

Frontend:
- `frontend/nuxt.config.ts`
- `frontend/src/composables/ws-rpc.ts`
- `frontend/src/composables/last-chat.ts`
- `frontend/src/pages/chat/*`
- `frontend/src/pages/console/*`
- `frontend/src/pages/user/[nickname]/*`
- `frontend/src/pages/vpn/*`
- `frontend/src/scriptable/*`
- `frontend/src/pages/games/*`

Основные страницы:
- `/chat` — чат, директы, комнаты;
- `/direct/[nickname]` — direct route;
- `/console` — общий экран с вкладками пользователя, комнат, VPN и инвайтов;
- `/user/[nickname]` — лёгкий redirect в `/console?tab=user&nickname=...`;
- `/vpn` — redirect в `/console?tab=vpn`;
- `/invites` — redirect в `/console?tab=invites`.

## Пользователи и уведомления
- `anonymous` не должен попадать в `user:list` и `contacts:list`, а также не должен добавляться в контакты;
- browser notifications в `/chat` не завязаны на флаг `webPushEnabled`: если событие не из текущего открытого диалога, нотификация может показываться даже при активной вкладке.

## Конфиги
- `backend/config.json`
- `frontend/config.json`
- `scripts/config.json`

`backend/config.json` обязателен для старта backend.

## Локальный запуск
```bash
yarn run backend:runner:dev
yarn run backend:dev
yarn run frontend:dev
```

## Prisma / БД
- runtime backend использует `backend/config.json -> db.url`;
- Prisma CLI использует `DATABASE_URL`;
- перед `prisma generate/push/migrate` URL должны совпадать.

## Временно отключено
`demo:room_meter` временно выключен:
- `backend/src/scriptable/registry.ts`
- `backend/src/script-runner/registry.ts`
- `backend/src/db.ts` (автопривязка)
- `frontend/src/pages/chat/index.vue` (баннер room runtime скрыт)

Весь chat scriptable/runtime сейчас тоже спит:
- `message:create(kind='scriptable')` возвращает `scriptable_disabled`;
- `runtime:action` возвращает `scriptable_disabled`;
- `room:surface:set` возвращает `scriptable_disabled`;
- `room:runtime:get` отдаёт `roomRuntime:null`;
- старые `messages.kind='scriptable'` на клиенте рендерятся как обычный fallback без runtime.

## Что проверять после правок
- после каждого изменения актуализировать `AGENTS.md`;
- после задачи — визуальная проверка через headless Chromium;
- на мобильной вёрстке проверять длинные названия комнат в левом drawer (без горизонтального скролла/переполнения);
- для существенных изменений поведения обновлять `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md`;
- после фронтовых/WS правок прогонять `yarn run test:login` или `yarn run smoke`;
- после локального запуска сервисов — остановить процессы.

## Актуализация 2026-04-25
- анонимная отправка в direct считается "своей" на клиенте даже если `message:created` прилетает раньше RPC-ответа `message:create`;
- для этого pending-маркер анонимного сообщения ставится до отправки RPC и затем уточняется по `messageId` из ответа.
- backend анонимной отправки пишет `messages.sender_id` как `id` системного `anonymous`; при отсутствии такого пользователя backend создаёт его автоматически.
- логин `anonymous` доступен с паролем `123` (backend при необходимости принудительно обновляет hash этого пользователя).
- из header чата убран legacy fallback `Общий чат`: при отсутствии `activeDialog` заголовок теперь пустой, для group fallback теперь `Комната`;
- убран визуальный рывок заголовка по клику: для `.title-button` отключён `:active` transform/filter;
- заголовок group-уведомлений теперь берётся из реальной комнаты (`joined/public/general`) и больше не хардкодится строкой `Общий чат`.
- роутинг чата нормализует путь (`/chat` и `/chat/` считаются одинаковым route): `room` query больше не теряется при reload;
- вход на `/chat/` теперь обрабатывается как вход на `/chat`: применяется редирект в `last-chat` (если есть) иначе открывается первая доступная комната;
- `last-chat` теперь хранится в каноническом виде (убираются хвостовые `/` у path-части: `/chat/` -> `/chat`, `/direct/user/` -> `/direct/user`).
- в меню директов закреплённые контакты показываются даже без созданного диалога: для них рисуются synthetic direct entries;
- клик по synthetic direct entry создаёт/открывает директ через `room:direct:get-or-create` (`selectPrivate`), после чего список директов обновляется.
- при открытии `/chat?room=<id>` route-resolve теперь сначала использует реальные данные комнаты из `joinedRooms/publicRooms` (включая `postOnlyByAdmin` и `joined`), а не “пустую” заглушку; это убирает flicker composer/pin при возврате из `/console`.
- при переключении между диалогами введён флаг `dialogSwitching`: во время switch в ленте показывается только `Загрузка...` (без промежуточного `Нет сообщений` и без рендера старой ленты), что убирает flicker `old -> empty -> loading -> new`.
- надпись `Нет сообщений` в ленте чата полностью убрана, чтобы не было резкого мигания текста между состояниями загрузки/переключения.
- лимит upload-изображений поднят до `50MB` (backend `uploads.maxBytes`, frontend chat/console-ограничения);
- backend upload теперь дополнительно нормализует изображения (кроме `gif/svg`) до `max 1024x1024` с сохранением пропорций через `sharp`; это страхует кейсы, когда клиентское ужатие по какой-то причине не сработало.
- фикс пустого чата при первом входе через редирект `/chat -> /chat?room=<id>`: после включения `routeSyncReady` теперь принудительно вызывается `onRouteChanged()`, чтобы догнать пропущенное изменение маршрута и выбрать диалог без ручного refresh.
- web-push для direct теперь всегда приходит по каноническому URL `/chat?room=<directRoomId>&focusMessage=<messageId>`; клик по push открывает нужный диалог и сразу фокусит целевое сообщение без цепочки редиректов через `/direct/*`.
- service worker на `notificationclick` теперь нормализует переход по `roomId/messageId` из payload в `/chat?room=...&focusMessage=...`, даже если в `url` пришёл legacy-path.
- backend web-push дополнительно всегда исключает из получателей `senderId` и `message.authorId`, чтобы отправитель не получал push на собственные сообщения.
- openNotification в чате теперь в приоритете резолвит диалог по `roomId` (`buildDialogFromRoomRoute`), а не по `targetUser`; это убирает ложные переходы в неверный direct и fallback в `/chat`.
- в `/console?tab=rooms&roomId=<id>` клик по участнику комнаты теперь открывает профиль этого пользователя (`/console?tab=user&nickname=<nickname>`), кнопка `Выкинуть` больше не триггерит этот переход из-за `@click.stop`.
- удаление group-комнаты убрано из верхнего `chat`-хедера (корзина больше не показывается для room) и перенесено в `console` на страницу комнаты: у админа есть явная кнопка `Удалить комнату`.

## Актуализация 2026-04-28
- при входе в comment-room (`/chat?room=<commentRoomId>`) исходное сообщение комментариев теперь показывается в pinned-panel как клиентский fallback, если сервер не вернул обычный room pin;
- для такого discussion fallback-пина скрыт action `откреп.`, чтобы не предлагать unpin для синтетического закрепа;
- в message actions кнопка комментариев (`облачко + count`) стала заметно светлее, если `commentCount > 0`;
- после `contacts:add/remove` из `/console` отправляется `contacts:updated` в event-bus, а `/chat` сразу перечитывает `contacts:list`; дополнительно этот рефреш срабатывает при возврате фокуса/видимости вкладки, поэтому удалённые контакты сразу пропадают из левого списка директов (включая synthetic pinned entries).
- web-push теперь поддерживает `room.kind='comment'`: получатель — автор исходного сообщения (если комментарий оставил другой пользователь), url пуша ведёт в конкретную comment-room (`/chat?room=<commentRoomId>&focusMessage=<commentMessageId>`), заголовок пуша — `MARX · Комментарии`.
- textarea композера в чате теперь автоподстраивает высоту по контенту и растёт максимум до `40vh` (дальше включается внутренний скролл поля);
- textarea при редактировании сообщения (`message-edit-input`) теперь тоже автоподстраивает высоту по контенту и растёт максимум до `40vh` (дальше включается внутренний скролл поля);
- composer tools (эмодзи + форматирование) теперь применяются в активное поле ввода: если открыт `message-edit-input`, вставка/обёртки идут в него, иначе в основной composer textarea;
- при открытии/использовании composer-tools во время редактирования сообщения target больше не сбрасывается в `main` из-за потери фокуса: `captureActiveComposerInputSelection()` сохраняет `edit` target, а кнопки панели используют `@mousedown.prevent`, чтобы не выбивать фокус из `message-edit-input`;
- левый список директов теперь скрывает «пустые» direct-room (без сообщений), если пользователь не в контактах: показываются только direct с `lastMessageAt > epoch` или контакты (`contacts:list`, включая synthetic pinned entries);
- в левом списке директов у каждого пользователя добавлен статус-индикатор как в room members: зелёная точка при `targetUser.isOnline=true`, серая при offline;
- backend теперь возвращает `isOnline` в user/direct payloads (`user:list`, `user:get`, `contacts:list`, `room:list(kind='direct')`, `room:get(kind='direct')`, `room:direct:get-or-create`), поэтому online в директ-UI вычисляется тем же источником, что и в room members;
- в хедере активного direct добавлен online/offline индикатор собеседника (точка рядом с именем);
- на странице профиля пользователя (`/console?tab=user`) добавлен online/offline индикатор в блоке имени;
- при возврате фокуса/видимости вкладки `/chat` теперь перечитывает не только `contacts:list`, но и `room:list(kind='direct')`, чтобы online-статусы в списке директов актуализировались сразу;
- сортировка директов в левом drawer обновлена под приоритет: `1) unread`, `2) online`, `3) алфавит (name/nickname)`; сортировка по `lastMessageAt` и приоритет закрепа в ordering убраны;
- звук уведомлений усилен по отказоустойчивости: `SoundPlayer` больше не «падает насовсем» при единичной ошибке загрузки/декода, использует `Promise.allSettled` для preload и fallback через `HTMLAudioElement`, а `playNotificationSound` при ошибке сбрасывает только инстанс плеера для автоповтора, не выключая глобальный `soundReady`;
- воспроизведение уведомлений переведено на `frontend/src/composables/classes/sound-player.ts`; `soundList` очищен от legacy-набора и оставлен один звук `notification: '/ping.mp3'`.
- backend `config.json` теперь явно содержит секцию `webrtc` (`iceServers` + `callRingTimeoutMs`), чтобы голосовые direct-звонки использовали конфиг без fallback-режима по умолчанию.
- локальный e2e-конфиг `scripts/config.json` возвращён на пароль `123` для пользователя `lisov`; TURN-заглушки `CHANGE_ME` в `backend/config.json` заменены на конкретные значения (`username`/`credential`) для webrtc-секции.
- для входящего звонка в чате добавлен отдельный звук `incomingCall: '/ringtone.mp3'`; обычные уведомления сообщений остаются на `notification: '/ping.mp3'`.
- в `playNotificationSound` и `playIncomingCallSound` убран фильтр `isWindowInactive()`: звуки теперь играются и при неактивной вкладке/окне.
- в call overlay добавлена вибрация на пользовательские call-actions: `Завершить` (hangup) и `Вкл./Выкл. микрофон` (mute toggle); системный `hangup('failed')` по ошибкам по-прежнему без хаптика.
- добавлены отдельные call-звуки: `callOn: '/callon.mp3'` и `callOff: '/calloff.mp3'` в `SoundPlayer`.
- `callOn` проигрывается на действии `Ответить`, `callOff` — на `Отклонить`, `Завершить` и при прерывании звонка (`call:ended`, потеря WS-соединения в активном звонке).
- при исходящем звонке в фазе ожидания ответа (`callPhase='outgoing'`) теперь лупится `callout.mp3`; музыка останавливается при любом выходе из фазы ожидания (accepted/ended/hangup/disconnect/reset/dispose) и при выключении звука.
- подписки/отписки событий в `frontend/src/pages/chat/script.ts` упрощены до прямых вызовов `on/off` и `add/removeEventListener` без промежуточных handler-прокладок и без массивов `busBindings/windowBindings`; сохранён только отдельный метод `onWsDisconnectedWithCall` для объединённого side-effect (`onDisconnected` + `onCallWsDisconnected`);
- в `frontend/src/pages/games/session/[id]/script.ts` подписки `game:session:updated`, `game:state:updated`, `message:created` переведены на прямые `on/off` без временных коллекций биндингов;
- в `frontend/src/pages/chat/message-item/script.ts` и `frontend/src/pages/chat/components/chat-composer/script.ts` удалены промежуточные resize-handler поля: resize теперь вешается/снимается напрямую на методы;
- в `frontend/src/pages/chat/modules/methods-message-body-and-reactions.ts` drag-listeners pinned-splitter переведены на прямые методы `onPinnedSplitterPointerMove/onPinnedSplitterPointerUp` без хранения прокси-ссылок;
- headless визуальная проверка после чистки прокладок повторно прогнана с автосозданием второго пользователя по инвайту: проверены `/chat` (mobile/desktop), direct call overlay (outgoing/incoming/connecting/ended), `/console` (user/rooms/vpn/invites), `/games`, роуты `/invites` и `/vpn`; скриншоты сохранены в `tmp/visual-full-1777385160499`.
- `SoundPlayer` поддерживает loop-воспроизведение (`playLoop/stopLoop/stopAllLoops`); входящий `ringtone.mp3` теперь запускается в цикле и останавливается при answer/reject/accepted/ended/disconnect/reset/dispose и при отключении звука.
- добавлен глобальный плагин `frontend/src/plugins/call-bridge.client.ts`: авторизованный клиент поддерживает WS-сессию не только в `/chat`, ловит `call:incoming` на любых страницах и переводит в `/chat?room=<roomId>&callId=<callId>` (кроме `/login`, `/invites`, `/invite/*`).
- `handleCallRouteIntent` в чате теперь поднимает ringtone и для route-based входящего звонка (когда пользователь пришёл в чат по `callId` не через активную chat-страницу).
- topbar `/console` больше не показывает `Console`: если PWA не установлена, показывается кнопка `Установить приложение`; если установлена — текст `Консоль`.
- громкость входящего рингтона поднята отдельно от прочих звуков: добавлена константа `INCOMING_CALL_SOUND_VOLUME=0.8`, `playIncomingCallSound` использует её вместо общего `NOTIFICATION_SOUND_VOLUME`.
- backend теперь отправляет incoming-call web-push всегда при `call:start` (не только когда получатель оффлайн): из `call:start` убран оффлайн-фильтр и исключение online-пользователей для `sendIncomingCallPush`.
- клиентский browser Notification для входящего звонка больше не ограничен состоянием неактивного окна: `showIncomingCallBrowserNotification` показывает уведомление при наличии разрешения даже в активной вкладке.
- добавлен глобальный plugin `frontend/src/plugins/haptics-buttons.client.ts`: при клике на любой `<button>` срабатывает `vibrateTap`, если `chat:vibration-enabled:v1` не выключен в localStorage (покрывает `/console` и остальные страницы).
- в `frontend/src/utils/vibrate.ts` добавлен антидребезг (`MIN_VIBRATION_GAP_MS=45`), чтобы глобальный haptic и локальные вызовы не давали двойную вибрацию подряд.
