# ANDROID_APK

MARX Android APK собирается как Capacitor-приложение поверх текущего Nuxt 3 SPA. Внутри APK лежит локальная статика из `frontend/.output/public`, backend остаётся внешним: `https://marx.core5.ru`, WebSocket: `wss://marx.core5.ru/ws`.

## Что уже сделано
- Android wrapper на Capacitor в `frontend/android`
- native Android push через RuStore Push SDK
- foreground-уведомления через `@capacitor/local-notifications`
- browser web-push внутри Android runtime выключен
- reconnect WebSocket усилен под `resume / network / VPN toggle`
- launcher icons обновлены из `frontend/src/public/pwa-192.png`
- permissions для `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`

## Подготовка frontend
```bash
cd frontend
yarn install
cp config.example.json config.json
yarn generate
```

Проверка, что web assets реально собраны:
```bash
ls -l .output/public/index.html
```

## RuStore Push project
1. В RuStore Console создай project для Push.
2. Package name Android app:
```text
ru.core5.marx
```
3. Добавь release SHA-256 подписи APK/AAB в настройки проекта.
4. Возьми `rustoreProjectId` из настроек/URL проекта RuStore Push.
5. Возьми `service token` для server-side отправки push.
6. `service token` в git не коммитится.

## Конфиг frontend
В `frontend/config.json` нужна секция:
```json
{
  "nativePush": {
    "provider": "rustore",
    "rustoreProjectId": "..."
  }
}
```

Без `rustoreProjectId` APK соберётся и запустится, но нативная регистрация token не включится.

## Конфиг backend
В `backend/config.json` нужна секция:
```json
{
  "nativePush": {
    "enabled": true,
    "provider": "rustore",
    "rustoreProjectId": "...",
    "rustoreServiceToken": "...",
    "androidPackageName": "ru.core5.marx"
  }
}
```

`rustoreServiceToken` в репу не коммитить. В `backend/config.example.json` оставлен пустой placeholder.

## Синхронизация Android проекта
```bash
cd frontend
yarn android:sync
```

Команда делает:
1. `yarn generate`
2. `cap sync android`

После этого Capacitor:
- копирует `.output/public` в `frontend/android/app/src/main/assets/public`
- обновляет plugins/Gradle wiring для Android

## Открыть в Android Studio
```bash
cd frontend
yarn android:open
```

Если Capacitor не знает путь к Android Studio:
```bash
export CAPACITOR_ANDROID_STUDIO_PATH=/home/lisov/.local/share/JetBrains/Toolbox/apps/android-studio/bin/studio
```

Потом снова:
```bash
yarn android:open
```

## Запуск на телефоне
1. Включи `Developer options`.
2. Включи `USB debugging`.
3. Подключи телефон.
4. Открой `frontend/android` в Android Studio.
5. Нажми `Run 'app'`.

CLI-вариант:
```bash
cd frontend
yarn android:run
```

## Запуск на эмуляторе
1. Создай AVD в Android Studio.
2. Запусти эмулятор.
3. Нажми `Run 'app'`.

CLI-вариант:
```bash
cd frontend
yarn android:run
```

## Где лежит debug APK
После debug-сборки:
```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

## Как frontend получает RuStore push token
На Android runtime приложение:
1. не запускает browser web-push;
2. инициализирует RuStore Push SDK через локальный Capacitor plugin `RuStorePush`;
3. получает RuStore push token;
4. пишет token в `localStorage`;
5. логирует token в WebView console;
6. отправляет token в backend через WS RPC:
   - `push:native:register`
7. при logout отправляет:
   - `push:native:unregister`

Токены хранятся в Postgres в таблице `native_push_tokens`.

## Как проверить push token в WebView console
Открой:
```text
chrome://inspect/#devices
```

Потом найди лог:
```text
[rustore-push] token ...
```

## Как проверить test push через RuStore Console
1. Собери и установи APK на реальный Android-телефон.
2. Залогинься в MARX.
3. Открой `chrome://inspect/#devices` и скопируй push token из console.
4. В RuStore Console открой форму test push.
5. Вставь token устройства.
6. Укажи `title` и `body`.
7. Отправь push.
8. Проверь уведомление на телефоне.

## Как проверить backend push на сообщения
1. Настрой `rustoreProjectId` и `rustoreServiceToken` в `backend/config.json`.
2. Прогони миграции backend:
```bash
cd backend
yarn prisma migrate deploy
```
3. Собери и запусти backend.
4. Установи APK и залогинься на телефоне.
5. Отправь сообщение этому пользователю с другого клиента.
6. Проверь:
   - при background/locked screen приходит native notification;
   - по tap открывается `/chat?room=...`;
   - если в payload есть `messageId`, добавляется `focusMessage=...`.

## Как проверить push на входящий звонок
1. Залогинься на телефоне как получатель.
2. С другого клиента начни direct-звонок.
3. Проверь:
   - приходит native notification `Входящий звонок`;
   - по tap открывается `/chat?room=...&callId=...`;
   - если приложение было открыто, в foreground всё равно появляется локальная нотификация.

Для звонков используется отдельный Android channel `marx-calls` с более высоким приоритетом, чем обычные сообщения `marx-messages`.

## Как проверить notification permission
1. Установи APK на Android 13+.
2. При первом старте приложение должно запросить notifications permission.
3. Если отказал, проверь вручную:
   - `Settings -> Apps -> MARX -> Notifications`

## Как проверить микрофон
1. Открой direct.
2. Запусти звонок.
3. При первом `getUserMedia({audio:true})` Android WebView должен запросить микрофон.
4. Если всё ок, собеседник слышит голос.

Capacitor `BridgeWebChromeClient` уже умеет пробрасывать `AUDIO_CAPTURE` в runtime permission request, так что отдельный костыль под микрофон не нужен.

## Как проверить reconnect после VPN toggle
1. Открой приложение.
2. Залогинься.
3. Открой любой чат.
4. Включи VPN.
5. Выключи VPN.
6. Сверни/разверни приложение.
7. Проверь, что:
   - приложение не висит на splash/index;
   - WebSocket переподключается;
   - чат снова живой без ручного force-close.

Native runtime слушает:
- `App.resume`
- `App.appStateChange`
- `Network.networkStatusChange`
- `window.online`
- `window.offline`

И на этом вызывает `forceWsReconnect(...)`.

## Как смотреть Android / RuStore / WebView логи
```bash
/home/lisov/Android/Sdk/platform-tools/adb logcat | grep -iE 'RuStore|Push|Capacitor|Notification|MARX|WebSocket|Network|chromium'
```

## Backend проверка
```bash
cd backend
yarn install
yarn prisma generate
yarn build
```

Если новая БД уже существует и нужно применить миграции:
```bash
cd backend
yarn prisma migrate deploy
```

## Полный минимальный smoke path
```bash
cd frontend
yarn install
cp config.example.json config.json
yarn generate
yarn android:sync
CAPACITOR_ANDROID_STUDIO_PATH=/home/lisov/.local/share/JetBrains/Toolbox/apps/android-studio/bin/studio yarn android:open
```

Backend:
```bash
cd backend
yarn install
yarn prisma generate
yarn build
```

## Что здесь специально не сделано
- нет Firebase / FCM
- нет Yandex Disk transport
- нет foreground service
- нет VoIP CallStyle notification
- не переписан WebSocket protocol
- не выпилен browser web-push для web/PWA версии
- не переписаны auth/session/message flows
- не переписан UI
