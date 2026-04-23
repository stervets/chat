# Scriptable Runtime MVP Report

## Что сделано

- Scriptable runtime переведён на node-модель (`client_script`, `server_script`, `nodes.data`).
- Runtime action/data sync работает через `runtime:action` + `runtime:data:updated`.
- Snapshot payload унифицирован на `nodeType/nodeId/clientScript/serverScript/data`.
- Frontend runtime manager/worker синхронизирован с этим snapshot-контрактом.
- Runner transport переведён на `nodeType/nodeId` и runtime-поля без legacy `script*Json` ключей.

## Архитектурный итог

- Нет отдельного graph/spaces/script storage слоя.
- Runtime identity и lifecycle едины для timeline/pinned.
- Persistent runtime data живёт в `nodes.data`.
- Demo-runtime использует нейтральные ключи `nodes.data.config` и `nodes.data.state`.

## Что сознательно не делали

- enterprise-абстракции и dual-model;
- совместимость с legacy runtime hooks;
- отдельный тяжёлый script engine вне текущего WS/runner pipeline.
