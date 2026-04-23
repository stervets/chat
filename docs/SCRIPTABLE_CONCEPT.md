# Scriptable Concept

## Цель

Минимальный runtime для интерактивных `message` и `room` без отдельного frontend-приложения под каждый кейс.

## Runtime identity

Один runtime instance на одну node-сущность:

- `message:<id>`
- `room:<id>`

Pinned view использует тот же instance по `messageId`.

## Lifecycle

1. `init`
2. `mount` (переход active views `0 -> 1`)
3. `data:update`
4. `unmount` (переход active views `1 -> 0`)

## Event pipeline

Единый envelope:

```ts
type ScriptRuntimeEvent = {
  source: 'ui' | 'room' | 'server' | 'system';
  type: string;
  payload?: any;
}
```

- `ui` — пользовательские действия.
- `room` — события комнаты.
- `server` — runtime data update / runtime action error.
- `system` — lifecycle/runtime события.

## Data model

- persistent runtime data лежит в `nodes.data`;
- `scriptState` и `scriptConfig` могут использоваться как обычные ключи внутри `data`, если конкретному script это нужно;
- local state: только worker
- effects (звук/вибрация/одноразовые вещи): не хранить в persistent runtime data

## Room surface

`roomSurface` в `nodes.data.roomSurface` описывает UI-поверхность комнаты:

- `enabled`
- `type`
- `config`
- pinned scriptable message как surface node

Это derived-поведение поверх room/message nodes, не отдельная structural модель.
