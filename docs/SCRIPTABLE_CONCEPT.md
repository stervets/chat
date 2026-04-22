# Scriptable Chat Concept (MVP)

## Цель слоя

Scriptable runtime нужен как минимальная платформа для интерактивных `message` и `room` сценариев без отдельного frontend-приложения на каждый кейс.

Поддерживаются режимы:

- `client`
- `client_server`
- `client_runner`

## Runtime Identity

Базовое правило: **один runtime instance на одну сущность**.

- message runtime identity: `message:<messageId>`
- room runtime identity: `room:<roomId>`

Pinned-рендер не создаёт второй runtime для message. Он использует тот же runtime по `messageId`.

## Lifecycle (формализовано)

Lifecycle для scriptable message/room:

1. `init`
- происходит при создании worker runtime (`onInit`)
- триггерится один раз на instance

2. `mount`
- происходит, когда в UI появляется хотя бы один view этой сущности
- в runtime приходит system event `lifecycle:mount`
- если views несколько (например timeline + pinned), mount всё равно один на переход `0 -> 1`

3. `update`
- происходит при изменении persistent/shared state
- в runtime приходит unified event `state:update`

4. `unmount`
- происходит, когда последний view исчезает из UI
- в runtime приходит system event `lifecycle:unmount` на переход `1 -> 0`

Важно: unmount view не равен dispose runtime. Runtime может жить без активного view до следующего sync/drop.

## Event Pipeline

Все события в runtime приводятся к единому формату:

```ts
type ScriptRuntimeEvent = {
  source: 'ui' | 'room' | 'server' | 'system';
  type: string;
  payload?: any;
}
```

Источники:

- `ui`: действия пользователя (`ui:action`)
- `room`: события комнаты (`chat_message`, `chat_message_updated`, `chat_message_deleted`)
- `server`: shared-state update (`state:update`) и server-side ошибки действия (`shared_action_error`)
- `system`: lifecycle/runtime/ws события (`runtime:init`, `runtime:dispose`, `lifecycle:*`, `system:*`)

Для room runtime дополнительно прокидывается room-event `script_action` после успешного `scripts:action` (через текущий room-event pipeline).

Единственный event hook runtime: `onEvent`. Legacy hooks не поддерживаются.

## State vs Effects

### Persistent state (shared)

Хранится на сервере/в БД, синхронизируется через `scripts:state`:

- `messages.script_state_json`
- `rooms.script_state_json`

Используется через `getSharedState()` и server event `state:update`.

### Local state

Хранится только в runtime worker на клиенте:

- `getLocalState()`
- `setLocalState(next)`

Не синхронизируется между пользователями.

### Effects

Effect = побочное действие, которое не должно считаться состоянием:

- звук
- вибрация
- одноразовые UI side-effects

Эффекты не хранятся в persistent state. Persistent/shared state должен оставаться чисто данными.

## Pinned + Passive Effects

При двойном рендере одного message (timeline + pinned):

- runtime остаётся один
- pinned может быть вторым view
- второй view может работать в `passiveEffects` режиме

`passiveEffects=true` выключает локальные эффекты в этом view (например, повторное проигрывание звука), чтобы не было дублей side-effects.

## App Room Model (MVP)

`room` может работать как app-host:

- `roomApp.enabled=true` + `roomApp.appType`
- `pinned scriptable message` выступает app-surface
- `room script` остаётся опциональным room-runtime оркестратором

Модель явная: app room не определяется “по совпадению”, а приходит отдельным `roomApp` payload в `dialogs:*` / `chat:join` / `chat:room-updated`.

## Cleanup / Устойчивость

`ScriptRuntimeManager`:

- корректно dispose'ит runtime при drop/disposeAll
- снимает worker handlers при terminate
- не постит события в уже остановленный runtime
- сохраняет local state при hot-restart (смена descriptor/revision)

## Границы MVP

Что НЕ делаем в текущем слое:

- отдельную новую архитектуру/graph-layer
- универсальный DSL событий
- server-driven mount/unmount orchestration

Что уже стабильно:

- единый runtime identity
- единый event envelope
- разделение state/effects
- корректная работа pinned scriptable без второго runtime
