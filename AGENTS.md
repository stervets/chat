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
- фикс смены пароля в `/console`: `wsChangePassword` теперь вызывается строкой, а не объектом (`{newPassword}`), из-за чего раньше пароль мог сохраниться как строка `"[object Object]"`.
- backend `auth:changePassword` ужесточён: поле `newPassword` принимается только как строка, нестроковый payload возвращает `invalid_input` и больше не может неявно пройти через `.toString()`.
- классификация `roomKind` для чат-уведомлений на клиенте (`resolveRoomKind`) больше не считает все non-general комнаты директами: теперь учитываются `activeDialog.kind`, `joinedRooms/publicRooms` и `directDialogs`; это убирает ложный addressed/unread и мигание favicon в обычных group-комнатах.
- добавлена защита от фантомного мигания favicon: в `updateFaviconBlinkByUnread` при `unreadNotificationsCount=0` и видимой вкладке `inactiveTabUnread` принудительно сбрасывается, чтобы blink не залипал из-за focus/visibility гонки без реальных уведомлений.
- backend `room:group:get-default` больше не выбирает “первую group-комнату в базе” без проверки доступа: теперь приоритет `joined` комнаты пользователя, затем `Новости MARX` (с авто-включением пользователя), затем public; fallback создаёт доступную пользователю группу и добавляет его в участники.
- в Telegram in-app браузере кнопки установки PWA скрыты: вместо них в `PwaInstallCard` и в topbar `/console` показывается жёлтое предупреждение с ссылкой `https://marx.core5.ru` и подсказкой открыть сайт во внешнем браузере.
- на странице `/invite/[code]` при открытии в Telegram in-app теперь выполняется автопопытка открыть инвайт во внешнем браузере (`Telegram.WebApp.openLink(..., {try_browser:'chrome'})`, Android `intent://` fallback и `window.open` fallback) и одновременно показывается явное жёлтое предупреждение `ОТКРОЙТЕ В БРАУЗЕРЕ` с прямой ссылкой `https://marx.core5.ru/invite/<code>`.
- на странице `/invite/[code]` добавлен видимый debug-блок `User-Agent`, который показывает текущее значение `navigator.userAgent` прямо в интерфейсе.
- для invite-flow добавлен резервный телеграм-детект без доверия к UA: режим Telegram включается не только по `isTelegramInApp`, но и по query-параметрам (`?src=tg|telegram|1`, `?from=...`) и по `document.referrer` (`t.me`/`telegram`); ссылки инвайтов из `/console` теперь генерируются как `/invite/<code>?src=tg`.
- по UI invite-страницы убран debug-блок `User-Agent`; в предупреждении оставлен текст `Если Вы открыли эту ссылку через Telegram, откройте её в обычном браузере!` с сохранением ссылки и кнопки `Попробовать открыть в браузере`; генерация invite-ссылок из `/console` возвращена к виду `/invite/<code>` без `?src=tg`.

## Актуализация 2026-04-30
- `frontend/src/pages/chat/message-scriptable/index.vue` остаётся тонким host-компонентом: dynamic `<component :is="...">`, fallback-empty/fallback-unknown и единый forwarding события `action`; конкретные scriptable-типы в шаблоне host больше не перечисляются.
- type-specific состояние, watchers, effects и action payloads вынесены из host в компоненты конкретных view: `view-guess-word` сам хранит input и отправляет `submit_guess`, `view-bot-control-surface` сам хранит level draft и отправляет `toggle_enabled`/`set_level`, `view-poll-surface` сам отправляет `vote_option`, `view-button-sound` сам управляет audio/soundTick.
- `frontend/src/pages/chat/message-scriptable/registry.ts` теперь хранит определения scriptable-view (`kind -> component`) и optional `buildProps`; host не знает, какому типу нужны дополнительные props, например `passiveEffects` для `button_sound`.
- стили scriptable-view разнесены по компонентам и подключаются через `frontend/src/components/chat/message-scriptable/components/shared-style.less`; родительский `message-scriptable/style.less` снова scoped и содержит только host layout.
- при аудите по frontend/backend не найдено второго UI-renderer с ветвлением по `viewModel.kind`; room/runtime UI сейчас остаётся временно отключённым по общей политике проекта.

## Актуализация 2026-05-14
- backend для `scriptable` сообщений в chat payload теперь сохраняет `kind='scriptable'` (не мапит в `text`) и отдаёт `runtime.clientScript/runtime.serverScript/runtime.data` из `node`;
- legacy fallback-текст для `scriptable` в `chat-context.messages` и `chat-dialogs.service` больше не подставляется, рендерится обычный `rawText`, чтобы клиент получал канонические runtime-данные.
- игровые картинки карт (`frontend/src/public/cards/*.gif`) удалены из git и добавлены в `.gitignore`, чтобы не раздувать репозиторий временными ассетами.
- `frontend/src/public/callout.mp3` перекодирован в `mono 48kbps` (mp3) для уменьшения веса ассета без изменения длительности.
- добавлен минимальный Android wrapper через Capacitor в `frontend`: `capacitor.config.ts` (`appId=ru.core5.marx`, `appName=MARX`, `webDir=.output/public`), платформа `frontend/android`, скрипты `android:sync/android:open/android:run` в `frontend/package.json`;
- для Android сохранён `INTERNET` permission;
- добавлена инструкция `docs/ANDROID_APK.md` с шагами `generate/sync/open/run` и путём к debug APK.
- `frontend/config.example.json` переведён на прод-адреса: `apiUrl=https://marx.core5.ru`, `publicUrl=https://marx.core5.ru`, `wsPath=/ws` (ws вычисляется как `wss://marx.core5.ru/ws`);
- для Android cleartext обратно отключён (удалён `android:usesCleartextTraffic`), т.к. мобильный клиент должен ходить на backend через HTTPS/WSS (`marx.core5.ru`).
- в Android runtime browser web-push/PWA-регистрация теперь отключены: `frontend/src/plugins/pwa.client.ts` и `frontend/src/composables/use-web-push.ts` рано выходят при `Capacitor.getPlatform()==='android'`, browser Notification API в чате тоже не используется как основной transport;
- добавлен native runtime helper `frontend/src/composables/native-runtime.ts` и плагины `frontend/src/plugins/native-runtime.client.ts` + `frontend/src/plugins/rustore-push.client.ts`; JS-обвязка RuStore живёт в `frontend/src/composables/rustore-push.ts`;
- Android APK теперь регистрирует RuStore push token через локальный Capacitor plugin `RuStorePush`; при foreground push показывает local notification через `@capacitor/local-notifications`, а по tap переводит в `/chat?room=...&focusMessage=...&callId=...`;
- frontend `ws.ts/ws-rpc.ts` усилены под mobile reconnect: `connect()` получил timeout `8000ms`, stale-socket guards и `forceWsReconnect(reason)`, который дёргается на `resume/appStateChange/networkStatusChange/online/offline`;
- стартовый route `/` и chat auth-check больше не держат пользователя в долгом retry-loop при мёртвом соединении: при сетевой ошибке идёт быстрый переход в `/chat` с reconnect/offline-поведением вместо вечного splash;
- backend получил native Android push через RuStore Push API: таблица `native_push_tokens` хранит `provider/platform/token`, конфиг `nativePush.enabled/provider/rustoreProjectId/rustoreServiceToken/androidPackageName`, WS-команды `push:native:register` и `push:native:unregister`, отправка RuStore push на новые сообщения и входящие direct-звонки;
- backend шлёт push в `https://vkpns-universal.rustore.ru/v1/send`, не логирует полный token и удаляет невалидные RuStore tokens по текстам provider-ошибок;
- Android manifest дополнен permissions `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, launcher icons пересобраны из `frontend/src/public/pwa-192.png`, а Android signing-мусор (`*.jks`, `*.keystore`, `key.properties`) добавлен в `.gitignore`;
- `docs/ANDROID_APK.md` и `docs/RUSTORE_PUSH.md` расширены инструкцией по RuStore project, `rustoreProjectId`, `rustoreServiceToken`, миграции `yarn prisma migrate deploy`, проверке test push, микрофона, WebView console и reconnect после VPN toggle.
- PWA/web-push полностью выпилены из `frontend/backend`: удалены `frontend/src/composables/use-web-push.ts`, `frontend/src/plugins/pwa.client.ts`, `frontend/src/public/sw.js`, `frontend/src/public/manifest.webmanifest`, UI/стейт/методы web-push из `/chat` и `/console`, а также backend `push.controller` + `web-push` сервис и `push` секция из backend-конфига; в проекте оставлен только native Android push-контур (RuStore).
- временно скрыты раздел `VPN` в `/console` и комната `Новости MARX` в клиентской навигации (`/chat` и `/console`); это только UI-фильтр на фронте, без удаления backend-логики.
- route `/vpn` теперь жёстко редиректит в `/console?tab=user` (без `tab=vpn`), чтобы старые deep-link/закладки не открывали скрытый VPN-раздел.
- в Android runtime (`isNativeAndroidApp`) browser push controls в `/console` скрыты, `Notification.requestPermission()` там больше не вызывается; остаётся только native permission для RuStore/local notifications.
- в чате fallback выбора стартового диалога усилен: если `joinedRooms` и `generalDialog` пусты (например после скрытия `Новости MARX`), автоматически открывается первая доступная `publicRooms` комната вместо пустого экрана.
- дополнительно к fallback выше: если видимых комнат вообще нет, клиент делает аварийный fallback на `room:group:get-default` даже для временно скрытой `Новости MARX`, чтобы после логина не оставаться на пустом фоне с `activeDialog=null`.
- фикс post-login пустого экрана: в `chat` восстановлены выпиленные методы `initBrowserNotifications` и `showBrowserNotification`, из-за отсутствия которых `mounted/notification` падали `TypeError` и не доходили до выбора первой доступной комнаты.
- route `/chat` больше не остаётся “без комнаты”: канонизация дефолтного group-диалога всегда пишет `room` в query (`/chat?room=<id>`), включая бывший general, поэтому после логина есть явный редирект в первую доступную комнату (например `room=1`).
- для SPA-режима Nuxt в Android/WebView отключён `experimental.payloadExtraction`, чтобы клиент не пытался грузить отсутствующие `/_payload.json` и не спамил warning `Cannot load payload ... Unexpected token '<'`.
- в `iframe allow` для message previews удалён `web-share`, чтобы WebView не показывал warning `Unrecognized feature: 'web-share'`.
- при открытии левого drawer в `/chat` вкладка навигации теперь всегда сбрасывается на `Комнаты` (`leftNavMode='rooms'` в `toggleLeftMenu`), чтобы дефолт не зависел от предыдущего состояния UI.
- в `frontend/src/plugins/rustore-push.client.ts` отключён вызов `RuStorePush.resolveError(...)` для `HostAppBackgroundWorkPermissionNotGranted`, чтобы Android-клиент не спамил нативным диалогом `Скачайте RuStore...` поверх интерфейса.
- во фронте временно скрыт раздел `Поддержка проекта` в `/console`: `DonationCard` обёрнут флагом `showProjectSupportSection=false` в `frontend/src/pages/console/index.vue` / `script.ts`.

## Актуализация 2026-05-16
- frontend `getApiBase/getWsUrlCandidates` теперь разводит endpoint-логику по рантайму: native app всегда ходит в `https://marx.core5.ru` (и `wss://.../ws`), обычный web-клиент на локали ходит в локальный backend `:<8816>`, а web на серверном host — в backend этого же host;
- в web-режиме убран приоритет `config.wsUrl` для WS-подключения (он теперь используется только в native runtime), чтобы локальный фронт не цеплялся к продовому `wss://marx.core5.ru/ws` при dev-запуске.
- добавлен резервный WS-канал через MAX как fallback transport без смены MARX packet format: frontend `ws/ws-rpc` может переключаться с обычного `/ws` на MAX bridge и продолжает слать те же пакеты `[com,args,senderId,recipientId,requestId]`;
- frontend добавил popup при недоступности основного WS: `Подключить резервный канал?` (`Да/Нет/Больше не предлагать`) с антиспам cooldown и localStorage-флагами `marx_reserve_channel_enabled` / `marx_reserve_channel_no_prompt`;
- в `/console` (профиль пользователя) добавлен тумблер `Резервный канал` для ручного включения/выключения fallback;
- frontend reserve transport переведён на Android native plugin carrier (`MaxNativeTransport`), а browser JS MAX transport больше не используется в рабочем пути;
- fallback popup/тумблер `Резервный канал` теперь доступны только в Capacitor Android runtime; в обычном браузере reserve считается недоступным и UI не показывается;
- frontend reserve crypto-модель обновлена: до login используется `_clientId + tmpSessionKey`, после успешного login сохраняется общий `maxSessionKey` пользователя и трафик идёт через `AES-256-GCM(maxSessionKey)`;
- backend добавил MAX bridge (`backend/src/ws/max-reserve.bridge.ts`) и конфиг `maxReserve` в `backend/config*.json`: подключение к MAX, приём inbound `recipientId=0`, RSA/AES decrypt, dispatch в существующий `ChatGateway`, отправка response/event обратно в MAX;
- backend MAX bridge хранит `maxSessionKey` в БД (`max_reserve_user_sessions`), делает ротацию ключа раз в 7 дней на успешном login, отдаёт `max.userId + max.maxSessionKey` только в encrypted login response и шлёт post-login packets на `recipientId=<userId>` без дублирования по clientId;
- backend `ChatGateway` поддерживает виртуальных reserve-клиентов и участвует в обычной рассылке `sendToUser/broadcastToAuthorized/broadcastToRoomMembers`, чтобы события доходили и по fallback-каналу;
- добавлены поля `maxReserve` в `frontend/config.example.json` и `backend/config.example.json`, а также обновлены `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE_TEST.md` с описанием reserve flow.
- browser-origin smoke подтвердил блокировку MAX WS для web-клиента (`http://127.0.0.1:* -> wss://ws-api.oneme.ru/websocket`, close `1006` до `open`);
- добавлен debug Capacitor plugin `MaxNativeSmokeTest` (`frontend/android/app/src/main/java/ru/core5/marx/MaxNativeSmokePlugin.java`) для native Android проверки MAX WS path: выставляет `Origin/User-Agent`, гоняет `opcode 6 -> 19 -> 64`, логирует шаги в `adb logcat` с tag `MaxNativeSmoke`;
- рабочий Android plugin `MaxNativeTransport` зарегистрирован в `MainActivity`, поддерживает `init/connect/disconnect/sendText`, event-каналы `state/message/error` и авто-reconnect; старый smoke-плагин оставлен в коде, но не участвует в рабочем fallback-пути.
- backend dual transport сделан always-on: обычный WS и MAX канал постоянно активны одновременно, а входящие команды из обоих каналов идут в единый `ChatGateway.onParsedPacket()/dispatch` без отдельной бизнес-ветки;
- для runtime-контроля двух каналов добавлен transport health monitor в `backend/src/ws/chat.gateway.ts` (периодический лог `wsOpen/wsAuthorized/maxConnected/maxLastInMs/maxLastOutMs/reserveUsers`);
- `MaxReserveBridge` получил статусные метрики (`getStatus`, `lastConnectedAtMs`, `lastInboundAtMs`, `lastOutboundAtMs`, `lastError`) для постоянного health-контроля MAX соединения.
- в MAX fallback добавлен chunking транспортного payload без изменения MARX packet format: внешний текст MAX теперь `A:<payload>` для коротких сообщений и `C:<chunkId>:<index>:<total>:<part>` для длинных, legacy-формат `<recipientId> <payload>` временно принимается как atomic;
- chunking работает симметрично на backend и frontend через codec-файлы `backend/src/ws/max-reserve-chunk-codec.ts` и `frontend/src/composables/classes/max-reserve-chunk-codec.ts`, лимит строки задаётся `maxReserve.chunkTextLimit` (default `3000`) в `backend/config*.json` и `frontend/config*.json`;
- сборщик чанков держит incomplete payload только в памяти (`recipientId + chunkId`, `max 100` чанков, TTL `2 минуты`), принимает out-of-order/duplicate чанки и не трогает crypto/MARX-слой до полной сборки payload.
- в Android native plugin `MaxNativeTransport` добавлена защита от stale socket callback-гонок при reconnect: socket-epoch проверка (`webSocket + epoch`), игнор старых `onOpen/onMessage/onFailure/onClosed`, debounce reconnect через один `reconnectRunnable`, и отмена лишних reconnect задач при новом открытии/закрытии сокета;
- в chat UI убрано залипание ошибки `Не удалось подключиться к диалогу.`/`Не удалось загрузить историю.`: при успешных `room:get` и `message:list` соответствующие error-сообщения автоматически очищаются.

## Актуализация 2026-05-17
- при e2e-тестах на реальном телефоне пользователь (`lisov`) вводит login/password вручную; агент не пытается автологиниться через adb-ввод credentials в webview;
- reserve-history в Android MAX fallback ужат до последних `10` сообщений: `message:list` в reserve-режиме теперь `limit=10`, бесконечная догрузка старой истории в reserve отключена;
- `auth:session` на фронте получил in-flight dedupe, чтобы не стрелять дубликатами при нестабильном reconnect;
- в `/chat` клик по комнате или директу в левом drawer теперь закрывает drawer сразу, до загрузки истории/роутинга, чтобы навигация не залипала до ответа reserve-канала;
- в `/chat` для reserve-режима добавлен blocking overlay ожидания ответа: показывается поверх контента, пока есть pending MAX RPC-запросы, и содержит кнопку `Повторить запрос`;
- reserve-клиент жёстче режет лишние MAX-пакеты: одинаковые in-flight запросы (`auth:session`, `room:list`, `room:get`, `message:list`, `contacts:list`, `user:list`, `room:group:get-default`, `push:native:register`) дедуплируются в `WsClient`, а навигационные fetch'и в чате (`fetchDirectDialogs/fetchPinnedDirectUserIds/fetchRoomsNavigation`) получают cooldown `1500ms` в reserve-режиме;
- MAX transport получил ротацию transport-channel: backend хранит `currentTransportChatId` + short-list `previousTransportChatIds`, создаёт private channel через `opcode 64` с `CONTROL(event=new, chatType=CHANNEL, access=PRIVATE)` и переключает отправку на новый chat;
- backend шлёт служебный packet `max:channel-switch`, Android native plugin `MaxNativeTransport` применяет новый `chatId` через `setChatId(...)` без reconnect;
- старый transport-channel держится в overlap (`channelSwitchOverlapMs`, default `120000`), затем backend пытается cleanup через `opcode 54` + `opcode 48`; ошибки cleanup только логируются;
- inbound MAX на backend фильтруется по `currentTransportChatId` и активным previous chatId, чтобы не обрабатывать мусор из чужих/устаревших каналов;
- добавлен smoke-check `yarn check:max-reserve-chunk` для codec/assembler (`short`, `long`, `out-of-order`, `duplicate`, `legacy`).
- reserve bootstrap в `/chat` дополнительно зажат module-level cache'ем для `user:list`, `room:list`, `contacts:list`, `room:group:get-default`, чтобы второй mount после route-normalize не повторял те же MAX-запросы;
- нормальный cold-start reserve trace сейчас такой: один `connect via reserve`, один `auth:session`, затем один `user:list`, один `room:list(kind='direct')`, один `contacts:list`, два `room:list(kind='group', scope='joined|public')`; повторный `room:group:get-default` на старте считается регрессией.
