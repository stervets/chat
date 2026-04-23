# Scriptable Runtime MVP Report

## Что сделано

- Scriptable runtime переведён на node-модель (`client_script`, `server_script`, `nodes.data`).
- Shared-state слой работает через `scripts:action` + `scripts:state`.
- Snapshot payload унифицирован на `nodeType/nodeId/clientScript/serverScript/data`.
- Frontend runtime manager/worker синхронизирован с этим snapshot-контрактом.
- Runner transport переведён на `nodeType/nodeId` и runtime-поля без legacy `script*Json` ключей.

## Архитектурный итог

- Нет отдельного graph/spaces/script storage слоя.
- Runtime identity и lifecycle едины для timeline/pinned.
- Persistent/shared state живёт в `nodes.data.scriptState`.
- Runtime config живёт в `nodes.data.scriptConfig`.

## Что сознательно не делали

- enterprise-абстракции и dual-model;
- совместимость с legacy runtime hooks;
- отдельный тяжёлый script engine вне текущего WS/runner pipeline.
