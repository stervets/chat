# Scriptable Runtime MVP Report

## Что сделано

- Расширена модель БД для scriptable message/room.
- Добавлен backend shared-state слой (`scripts:action`).
- Добавлен file-based script registry (backend/frontend/runner).
- Добавлен отдельный runner process + внутренний WS transport.
- Добавлен frontend worker runtime для message + room сущностей.
- Внедрён runtime hot-restart по `scriptRevision`.
- Интегрированы WS-события `scripts:state` в текущий чат-flow.
- Добавлены 3 demo-сценария:
  - `demo:fart_button` (client-only message),
  - `demo:guess_word` (shared-state message),
  - `demo:room_meter` (room-level runner script).

## Ключевые архитектурные решения

- Не делали отдельный heavy engine.
- Использован простой контракт:
  - script metadata в entity,
  - shared state в entity JSON,
  - action/event transport поверх текущего WS.
- Runner вынесен в отдельный процесс, но остаётся внутри репозитория.
- UI-runtime изолирован в Web Worker без sandbox/VM.

## Почему так

- Минимально встраивается в текущий код и протокол.
- Не ломает текущий чат и исторические команды `dialogs:*`.
- Простая отладка: всё читается по файлам, без внешней инфраструктуры.
- Понятная точка расширения: новый script = новый файл + registry entry.

## Что покрыто сейчас

- Scriptable message creation и render в bubble.
- Shared-state actions и синхронизация между клиентами.
- Room-level runtime и room banner.
- Room event -> runner -> state update -> broadcast.
- Local/client-only runtime без backend-зависимости.

## Что оставлено на будущее

- ACL/permissions на script mutation.
- Богатые side-effects (кроме system_message).
- Версионированные migration scripts под CI flow.
- Глубокая observability runner runtime.
- Полноценный набор e2e тестов именно под scriptable сценарии.
