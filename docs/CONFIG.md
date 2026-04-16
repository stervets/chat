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
  "inviteBaseUrl": "http://localhost:8815",
  "corsOrigins": [
    "http://localhost:8815",
    "http://127.0.0.1:8815"
  ],
  "db": {
    "path": "./data/marx.sqlite"
  }
}
```

SQLite файл создаётся автоматически при старте, если его ещё нет.
`db.path` указывается относительно папки `backend/`.
`inviteBaseUrl` используется CLI/TUI админкой для генерации полной ссылки на инвайт (`/invite/<code>`).

Если открываешь фронт через LAN IP, добавь `http://<LAN_IP>:8815` в `corsOrigins`,
а в `frontend/config.json` укажи `apiUrl` с тем же IP.
