# MARX / King

Актуальный статус игрового модуля `King` в текущем коде.

## Что уже реализовано

- runtime модульная система (`backend/src/modules-runtime/*`);
- модуль `king` (`backend/src/modules/king/*`);
- `rooms.kind = game`;
- таблицы `game_sessions`, `game_session_players`;
- solo-режим: `1` человек + `3` бота;
- серверная детерминированная логика на 12 раундов;
- бот-эвристики для хода;
- шаблонные бот-реплики/системные сообщения;
- фронт: `/games` и `/games/session/:id`.

## Что не реализовано

- публичные/инвайт-лобби;
- multiplayer с людьми;
- LLM-реплики;
- runtime enable/disable через БД-конфиг.

## Структура файлов (факт)

Backend:
- `backend/src/modules-runtime/types.ts`
- `backend/src/modules-runtime/registry.ts`
- `backend/src/modules/king/module.ts`
- `backend/src/modules/king/types.ts`
- `backend/src/modules/king/rounds.ts`
- `backend/src/modules/king/rules.ts`
- `backend/src/modules/king/scoring.ts`
- `backend/src/modules/king/bot-strategy.ts`
- `backend/src/modules/king/bot-cast.ts`
- `backend/src/modules/king/templates.ts`
- `backend/src/ws/chat/chat-games.service.ts`

Frontend:
- `frontend/src/composables/king.ts`
- `frontend/src/pages/games/*`
- `frontend/src/pages/games/session/[id]/*`

## Контракт модуля

См. `backend/src/modules-runtime/types.ts`:
- `GameModule.createInitialState`
- `GameModule.getPublicState`
- `GameModule.listActions`
- `GameModule.applyAction`
- `GameModule.runBotTurn?`

Реестр модулей: `backend/src/modules-runtime/registry.ts`.

## Текущий WS API для игр

Команды:
- `games:solo:create({moduleKey:'king'})`
- `games:session:get(sessionId)`
- `games:action({sessionId, action})`

События:
- `games:session`
- `games:event`
- `games:state`

Параллельно работает обычный чат в той же игровой комнате:
- `dialogs:messages(roomId, ...)`
- `chat:send(roomId, text)`
- realtime `chat:message`.

## Игровой action (сейчас)

Поддерживается один action:
```json
{"type":"play_card","payload":{"suit":"hearts","rank":"Q"}}
```

Ошибки: `invalid_card`, `not_your_turn`, `session_not_active`, `invalid_action`.

## DB модель (факт)

`room(kind='game')` связан с `game_session`:
- `game_sessions.room_id`
- `game_session_players(session_id, user_id, seat, kind, is_ready)`

`kind` игрока: `human | bot`.

## Flow solo

1. Клиент вызывает `games:solo:create`.
2. Backend создаёт `room(kind='game')`.
3. Backend создаёт `game_session(status='active', visibility='solo')`.
4. Добавляет человека и 3 ботов в `game_session_players` и `rooms_users`.
5. Инициализирует state через `kingModule.createInitialState`.
6. Отправляет `session`, начальные `events` и системные сообщения в room.

## Roadmap (если продолжать)

1. Лобби `public/invite_only` + join/invite команды.
2. Multiplayer (люди + боты в смешанном составе).
3. Ограниченные LLM-реплики поверх уже авторитетной серверной логики.
