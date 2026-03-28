# Config

Проект использует **только JSON-конфиг**, без переменных окружения.

## Frontend

Файлы:
- `frontend/config.example.json` — пример
- `frontend/config.json` — локальный (не в git)

Скопируй пример и отредактируй под себя.

Пример:
```json
{
  "mode": "dev",
  "apiUrl": "http://localhost:8816",
  "wsPath": "/ws"
}
```

`wsUrl` вычисляется из `apiUrl + wsPath` автоматически. При необходимости можно задать `wsUrl` явно.

## Backend

Файлы:
- `backend/config.example.json` — пример
- `backend/config.json` — локальный (не в git)

Скопируй пример и отредактируй под себя.

Пример:
```json
{
  "host": "0.0.0.0",
  "port": 8816,
  "wsPath": "/ws",
  "messagesTtlDays": 7,
  "corsOrigins": [
    "http://localhost:8815",
    "http://127.0.0.1:8815"
  ],
  "db": {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "marx",
    "password": "marx",
    "database": "marx_chat"
  }
}
```

Если открываешь фронт через LAN IP, добавь `http://<LAN_IP>:8815` в `corsOrigins`,
а в `frontend/config.json` укажи `apiUrl` с тем же IP.
