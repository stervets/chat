# RUSTORE_PUSH

Android APK в MARX использует RuStore Push. Service worker и browser web-push в проекте больше не поддерживаются; в открытой web-вкладке остаются обычные browser notifications от WS-событий.

## Что нужно настроить

Frontend `frontend/config.json`:
```json
{
  "nativePush": {
    "provider": "rustore",
    "rustoreProjectId": "..."
  }
}
```

Backend `backend/config.json`:
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

`rustoreServiceToken` в git не коммитится.

## Android package name
```text
ru.core5.marx
```

## Backend endpoint
Сейчас backend шлёт RuStore push в:
```text
https://vkpns-universal.rustore.ru/v1/send
```

## Что уходит в payload

Message push:
```json
{
  "type": "message",
  "roomId": "...",
  "messageId": "..."
}
```

Call push:
```json
{
  "type": "call",
  "roomId": "...",
  "callId": "..."
}
```

Дополнительно backend кладёт `title`, `body`, `provider`, `platform`, `channelId`.

## Регистрация token
Frontend получает token через локальный Capacitor plugin `RuStorePush`, потом шлёт его в backend по WS RPC:
- `push:native:register`
- `push:native:unregister`

Payload:
```json
{
  "provider": "rustore",
  "platform": "android",
  "token": "..."
}
```

## Проверка
1. Собери APK.
2. Залогинься на телефоне.
3. Проверь token в `chrome://inspect/#devices`.
4. Отправь test push из RuStore Console по этому token.
5. Потом проверь backend push сообщением или звонком со второго клиента.
