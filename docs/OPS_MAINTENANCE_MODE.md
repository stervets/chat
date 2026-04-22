# OPS: Maintenance Mode (Caddy Toggle)

Этот режим переключается на reverse-proxy слое (Caddy), без встраивания в runtime frontend/backend.

## Что добавлено

- Страница техработ: `ops/maintenance/index.html`
- Логотип страницы: `ops/maintenance/marx_logo.png`
- Caddy include-файлы:
  - `ops/caddy/marx-normal.routes.caddy`
  - `ops/caddy/marx-maintenance.routes.caddy`
  - `ops/caddy/marx-active.routes.caddy` (active include, symlink)
- Toggle-скрипт: `ops/caddy/toggle-maintenance.sh`
- Пример Caddyfile: `ops/caddy/Caddyfile.maintenance-example`

## Логика

- `Maintenance ON`:
  - backend/ws роуты (`/ws*`, `/push*`, `/upload/image`, `/uploads*`) отдают `503`;
  - все остальные пути отдают `ops/maintenance/index.html`.
- `Maintenance OFF`:
  - backend/ws снова проксируются на backend;
  - SPA снова раздаётся из frontend static build.

## Как использовать toggle

Из корня проекта:

```bash
./ops/caddy/toggle-maintenance.sh
```

Скрипт один и тот же для обоих режимов:
- если режим был выключен -> включит;
- если был включен -> выключит.

Скрипт пишет:
- `Maintenance mode: ON` или `Maintenance mode: OFF`
- куда указывает active include
- команду reload/restart Caddy

## Подключение на сервере

1. Скопировать на сервер:
- `ops/maintenance/*`
- `ops/caddy/*`

2. В Caddy-конфиге сайта добавить import active include, пример:

```caddy
marx.core5.ru {
    encode zstd gzip
    import /opt/chat/ops/caddy/marx-active.routes.caddy
}
```

3. Убедиться, что пути в include-файлах соответствуют серверу:
- normal root: `/opt/chat/frontend/.output/public`
- maintenance root: `/opt/chat/ops/maintenance`
- backend upstream: `127.0.0.1:8816`

4. После toggle:
```bash
sudo systemctl reload caddy
```

Если нужно сразу уронить уже открытые websocket-сессии:
```bash
sudo systemctl restart caddy
```

## Что происходит с уже открытыми клиентами

- Новые HTTP-запросы сразу пойдут на maintenance page.
- Новые WS reconnect попытки будут получать `503`.
- Для уже существующих живых WS-соединений мгновенный разрыв зависит от режима reload/restart Caddy.
  Для гарантированного обрыва активных соединений нужен `restart`.
- На maintenance page есть авто-refresh раз в 8 секунд: после выключения режима пользователь автоматически вернётся на рабочий сайт.

## Ограничения локальной проверки

Без локального Caddy нельзя полноценно проверить:
- реальный routing Caddy;
- live-переключение reverse proxy;
- фактический обрыв открытых WS на reload/restart.

Локально проверяются только сами файлы, toggle-скрипт и отображение статической maintenance page.
